import { pool } from "../config/db.js";
import { OfferService } from "./OfferService.js";
import { ProductPlaceholderService } from "./ProductPlaceholderService.js";

function localizedName(row, locale) {
  if (locale === "en") return row.name_en || row.name;
  if (locale === "ru") return row.name_ru || row.name;
  return row.name_uk || row.name;
}

function publicLocale(value) {
  const locale = String(value || "").toLowerCase();
  return ["uk", "en", "ru"].includes(locale) ? locale : "uk";
}

export const PublicCatalogService = {
  async getTree(locale = "uk", db = pool) {
    locale = publicLocale(locale);
    const result = await db.query(`
      SELECT c.id, c.parent_id, c.slug, c.name, c.name_uk, c.name_ru, c.name_en,
             c.sort_order, COUNT(DISTINCT catalog_product.id)::integer AS direct_product_count
      FROM categories c
      LEFT JOIN product_categories pc
        ON pc.category_id = c.id
        AND (
          pc.assignment_source = 'MANUAL'
          OR NOT EXISTS (
            SELECT 1
            FROM product_categories manual_pc
            WHERE manual_pc.product_id = pc.product_id
              AND manual_pc.assignment_source = 'MANUAL'
          )
        )
      LEFT JOIN products catalog_product
        ON catalog_product.id = pc.product_id
        AND catalog_product.is_active = TRUE
      WHERE c.is_active = TRUE
      GROUP BY c.id
      ORDER BY c.sort_order, c.id`);
    const rows = result.rows.map((row) => ({
      id: Number(row.id), parentId: row.parent_id === null ? null : Number(row.parent_id),
      slug: row.slug, name: localizedName(row, locale),
      directProductCount: Number(row.direct_product_count), children: [],
    }));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const roots = [];
    for (const row of rows) {
      if (row.parentId && byId.has(row.parentId)) byId.get(row.parentId).children.push(row);
      else roots.push(row);
    }
    for (const root of roots) {
      root.children = root.children.filter((child) => child.directProductCount > 0);
      root.productCount = root.children.reduce((sum, child) => sum + child.directProductCount, root.directProductCount);
    }
    return roots.filter((root) => (
      root.slug === "other"
      || root.directProductCount > 0
      || root.children.length > 0
    ));
  },

  async getCategoryProducts({ slug, locale = "uk", page = 1, pricingContext = null }, db = pool) {
    locale = publicLocale(locale);
    const categoryResult = await db.query(`
      SELECT c.*, p.slug AS parent_slug, p.name AS parent_name, p.name_uk AS parent_name_uk,
             p.name_ru AS parent_name_ru, p.name_en AS parent_name_en
      FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
      WHERE c.slug = $1 AND c.is_active = TRUE LIMIT 1`, [slug]);
    const row = categoryResult.rows[0];
    if (!row) return null;
    const limit = 24;
    const normalizedPage = Math.max(1, Number(page) || 1);
    const countResult = await db.query(`
      SELECT COUNT(*)::integer AS count FROM product_categories pc
      JOIN products p ON p.id = pc.product_id AND p.is_active = TRUE
      WHERE pc.category_id = $1
        AND (
          pc.assignment_source = 'MANUAL'
          OR NOT EXISTS (
            SELECT 1
            FROM product_categories manual_pc
            WHERE manual_pc.product_id = pc.product_id
              AND manual_pc.assignment_source = 'MANUAL'
          )
        )`, [row.id]);
    const productResult = await db.query(`
      SELECT p.id, p.article, p.article_normalized,
             COALESCE(requested_translation.name, default_translation.name, p.name) AS name,
             b.name AS brand_name,
             pm.name AS manufacturer,
             (SELECT pi.url FROM product_images pi WHERE pi.product_id=p.id
               ORDER BY pi.priority,pi.id LIMIT 1) AS image_url,
             ARRAY(
               SELECT pi.url
               FROM product_images pi
               WHERE pi.product_id = p.id
               ORDER BY pi.priority, pi.id
             ) AS image_urls
      FROM product_categories pc
      JOIN products p ON p.id = pc.product_id AND p.is_active = TRUE
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN part_manufacturers pm ON pm.id = p.manufacturer_id
      LEFT JOIN product_translations requested_translation
        ON requested_translation.product_id = p.id
        AND requested_translation.language_code = $4
      LEFT JOIN LATERAL (
        SELECT sl.code
        FROM site_languages sl
        WHERE sl.is_public_enabled = TRUE AND sl.is_default = TRUE
        ORDER BY sl.sort_order, sl.code
        LIMIT 1
      ) default_language ON TRUE
      LEFT JOIN product_translations default_translation
        ON default_translation.product_id = p.id
        AND default_translation.language_code = default_language.code
      LEFT JOIN LATERAL (
        SELECT TRUE AS has_available_offer
        FROM product_offers po
        LEFT JOIN warehouses w ON w.id = po.warehouse_id
        LEFT JOIN suppliers s
          ON s.id = COALESCE(po.supplier_id, w.supplier_id)
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(sr.quantity), 0) AS reserved_quantity
          FROM stock_reservations sr
          WHERE sr.product_offer_id = po.id
            AND (
              sr.status = 'ORDER_PENDING'
              OR (
                sr.status = 'ACTIVE'
                AND (
                  sr.order_id IS NOT NULL
                  OR sr.reserved_until IS NULL
                  OR sr.reserved_until > CURRENT_TIMESTAMP
                )
              )
            )
        ) reservations ON TRUE
        WHERE po.product_id = p.id
          AND po.is_available = TRUE
          AND po.is_hidden = FALSE
          AND GREATEST(
            po.quantity - COALESCE(reservations.reserved_quantity, 0),
            0
          ) > 0
          AND (w.id IS NULL OR w.is_active = TRUE)
          AND (s.id IS NULL OR s.is_active = TRUE)
        LIMIT 1
      ) availability ON TRUE
      WHERE pc.category_id = $1
        AND (
          pc.assignment_source = 'MANUAL'
          OR NOT EXISTS (
            SELECT 1
            FROM product_categories manual_pc
            WHERE manual_pc.product_id = pc.product_id
              AND manual_pc.assignment_source = 'MANUAL'
          )
        )
      ORDER BY
        CASE
          WHEN availability.has_available_offer IS TRUE THEN 0
          ELSE 1
        END,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM product_images pi_order
            WHERE pi_order.product_id = p.id
          ) THEN 0
          ELSE 1
        END,
        p.name,
        p.article
      LIMIT $2 OFFSET $3`, [row.id, limit, (normalizedPage - 1) * limit, locale]);
    const products = await Promise.all(productResult.rows.map(async (product) => {
      const image = ProductPlaceholderService.getProductImage({
        ...product,
        category: localizedName(row, locale),
        imageUrl: product.image_url,
        imageUrls: product.image_urls,
      });
      return {
        ...product,
        image_url: image.imageUrl,
        image_urls: image.imageUrls,
        hasRealImage: image.hasRealImage,
        isPlaceholder: image.isPlaceholder,
        offers: await OfferService.getOffersByProductId(product.id, pricingContext, locale),
      };
    }));
    return {
      category: {
        id: Number(row.id), slug: row.slug, name: localizedName(row, locale),
        parent: row.parent_id ? {
          slug: row.parent_slug,
          name: localizedName({ name: row.parent_name, name_uk: row.parent_name_uk,
            name_ru: row.parent_name_ru, name_en: row.parent_name_en }, locale),
        } : null,
      },
      products,
      pagination: { page: normalizedPage, pageSize: limit, total: Number(countResult.rows[0].count),
        pages: Math.max(1, Math.ceil(Number(countResult.rows[0].count) / limit)) },
    };
  },
};
