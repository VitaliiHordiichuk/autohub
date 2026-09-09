import { pool } from "../config/db.js";
import { OfferService } from "./OfferService.js";
import { ProductPlaceholderService } from "./ProductPlaceholderService.js";
import { publicProductName } from "./ProductNameService.js";

function localizedName(row, locale) {
  if (locale === "en") return row.name_en || row.name;
  if (locale === "ru") return row.name_ru || row.name;
  return row.name_uk || row.name;
}

function publicLocale(value) {
  const locale = String(value || "").toLowerCase();
  return ["uk", "en", "ru"].includes(locale) ? locale : "uk";
}

function catalogQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 100);
}

function catalogAvailability(value) {
  const normalized = String(value || "all").toLowerCase();
  return ["all", "available", "unavailable"].includes(normalized) ? normalized : "all";
}

function catalogPrice(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function catalogSort(value) {
  const normalized = String(value || "default").toLowerCase();
  return ["default", "price_asc", "price_desc", "name_asc"].includes(normalized)
    ? normalized
    : "default";
}

export const PublicCatalogService = {
  async getTree(locale = "uk", db = pool) {
    locale = publicLocale(locale);
    const result = await db.query(`
      WITH RECURSIVE visible_assignments AS (
        SELECT assignment.product_id, assignment.category_id
        FROM product_categories assignment
        WHERE assignment.assignment_source = 'MANUAL'
          OR (
            assignment.assignment_source = 'AUTO_RULE'
            AND NOT EXISTS (
              SELECT 1
              FROM product_categories manual_assignment
              WHERE manual_assignment.product_id = assignment.product_id
                AND manual_assignment.assignment_source = 'MANUAL'
                AND NOT category_is_within_tree(
                  manual_assignment.category_id,
                  'mb-accessories-b'
                )
            )
          )
          OR (
            assignment.assignment_source = 'ACCESSORY_RULE'
            AND NOT EXISTS (
              SELECT 1
              FROM product_categories manual_assignment
              WHERE manual_assignment.product_id = assignment.product_id
                AND manual_assignment.assignment_source = 'MANUAL'
                AND category_is_within_tree(
                  manual_assignment.category_id,
                  'mb-accessories-b'
                )
            )
          )
      ),
      category_descendants(ancestor_id, descendant_id) AS (
        SELECT id, id FROM categories WHERE is_active = TRUE
        UNION ALL
        SELECT tree.ancestor_id, child.id
        FROM category_descendants tree
        JOIN categories child
          ON child.parent_id = tree.descendant_id
          AND child.is_active = TRUE
      ),
      direct_counts AS (
        SELECT assignment.category_id, COUNT(DISTINCT assignment.product_id)::integer AS product_count
        FROM visible_assignments assignment
        JOIN products product ON product.id = assignment.product_id AND product.is_active = TRUE
        GROUP BY assignment.category_id
      ),
      descendant_counts AS (
        SELECT tree.ancestor_id AS category_id,
               COUNT(DISTINCT assignment.product_id)::integer AS product_count
        FROM category_descendants tree
        JOIN visible_assignments assignment ON assignment.category_id = tree.descendant_id
        JOIN products product ON product.id = assignment.product_id AND product.is_active = TRUE
        GROUP BY tree.ancestor_id
      )
      SELECT category.id, category.parent_id, category.slug, category.name,
             category.name_uk, category.name_ru, category.name_en, category.sort_order,
             COALESCE(direct_counts.product_count, 0)::integer AS direct_product_count,
             COALESCE(descendant_counts.product_count, 0)::integer AS product_count
      FROM categories category
      LEFT JOIN direct_counts ON direct_counts.category_id = category.id
      LEFT JOIN descendant_counts ON descendant_counts.category_id = category.id
      WHERE category.is_active = TRUE
      ORDER BY category.sort_order, category.id`);
    const rows = result.rows.map((row) => ({
      id: Number(row.id), parentId: row.parent_id === null ? null : Number(row.parent_id),
      slug: row.slug, name: localizedName(row, locale),
      directProductCount: Number(row.direct_product_count),
      productCount: Number(row.product_count),
      children: [],
    }));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const roots = [];
    for (const row of rows) {
      if (row.parentId && byId.has(row.parentId)) byId.get(row.parentId).children.push(row);
      else roots.push(row);
    }
    const removeEmptyChildren = (category) => {
      category.children = category.children
        .map(removeEmptyChildren)
        .filter((child) => child.productCount > 0);
      return category;
    };
    roots.forEach(removeEmptyChildren);
    return roots.filter((root) => (
      root.slug === "other"
      || root.productCount > 0
    ));
  },

  async getCategoryProducts({
    slug, locale = "uk", page = 1, query = "", availability = "all",
    minPrice = null, maxPrice = null, sort = "default", pricingContext = null,
  }, db = pool) {
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
    const normalizedQuery = catalogQuery(query);
    const normalizedArticleQuery = normalizedQuery.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const normalizedAvailability = catalogAvailability(availability);
    let normalizedMinPrice = catalogPrice(minPrice);
    let normalizedMaxPrice = catalogPrice(maxPrice);
    if (normalizedMinPrice !== null && normalizedMaxPrice !== null && normalizedMinPrice > normalizedMaxPrice) {
      [normalizedMinPrice, normalizedMaxPrice] = [normalizedMaxPrice, normalizedMinPrice];
    }
    const normalizedSort = catalogSort(sort);
    const discountPercent = Number(pricingContext?.discountPercent) || 0;
    const isVip = pricingContext?.isVip === true;
    const orderSql = {
      default: `CASE WHEN filtered.has_available_offer THEN 0 ELSE 1 END,
        CASE WHEN EXISTS (SELECT 1 FROM product_images pi_order WHERE pi_order.product_id=p.id) THEN 0 ELSE 1 END,
        filtered.display_name, p.article`,
      price_asc: "filtered.minimum_available_price ASC NULLS LAST, filtered.display_name, p.article",
      price_desc: "filtered.minimum_available_price DESC NULLS LAST, filtered.display_name, p.article",
      name_asc: "filtered.display_name, p.article",
    }[normalizedSort];
    const filteredProductsSql = `
      WITH RECURSIVE category_scope AS (
        SELECT id
        FROM categories
        WHERE id = $1 AND is_active = TRUE
        UNION ALL
        SELECT child.id
        FROM categories child
        JOIN category_scope parent ON child.parent_id = parent.id
        WHERE child.is_active = TRUE
      ),
      visible_assignments AS (
        SELECT assignment.product_id, assignment.category_id
        FROM product_categories assignment
        WHERE assignment.assignment_source = 'MANUAL'
          OR (
            assignment.assignment_source = 'AUTO_RULE'
            AND NOT EXISTS (
              SELECT 1
              FROM product_categories manual_assignment
              WHERE manual_assignment.product_id = assignment.product_id
                AND manual_assignment.assignment_source = 'MANUAL'
                AND NOT category_is_within_tree(
                  manual_assignment.category_id,
                  'mb-accessories-b'
                )
            )
          )
          OR (
            assignment.assignment_source = 'ACCESSORY_RULE'
            AND NOT EXISTS (
              SELECT 1
              FROM product_categories manual_assignment
              WHERE manual_assignment.product_id = assignment.product_id
                AND manual_assignment.assignment_source = 'MANUAL'
                AND category_is_within_tree(
                  manual_assignment.category_id,
                  'mb-accessories-b'
                )
            )
          )
      ),
      product_metrics AS (
        SELECT p.id,
          COALESCE(requested_translation.name, default_translation.name, p.name) AS display_name,
          CASE
            WHEN requested_translation.name IS NOT NULL THEN requested_translation.provider
            WHEN default_translation.name IS NOT NULL THEN default_translation.provider
            WHEN EXISTS (
              SELECT 1 FROM product_translations manual_name
              WHERE manual_name.product_id=p.id AND manual_name.provider='MANUAL'
                AND manual_name.name=p.name
            ) THEN 'MANUAL'
            ELSE NULL
          END AS name_provider,
          COALESCE(offer_metrics.has_available_offer,FALSE) AS has_available_offer,
          offer_metrics.minimum_available_price
        FROM products p
        LEFT JOIN product_translations requested_translation
          ON requested_translation.product_id=p.id AND requested_translation.language_code=$2
        LEFT JOIN LATERAL (
          SELECT sl.code FROM site_languages sl
          WHERE sl.is_public_enabled=TRUE AND sl.is_default=TRUE
          ORDER BY sl.sort_order,sl.code LIMIT 1
        ) default_language ON TRUE
        LEFT JOIN product_translations default_translation
          ON default_translation.product_id=p.id
          AND default_translation.language_code=default_language.code
        LEFT JOIN LATERAL (
          SELECT TRUE AS has_available_offer,
            MIN(CASE
              WHEN $9::boolean THEN ROUND(COALESCE(available.minimum_sale_price,available.retail_price)::numeric,2)
              ELSE GREATEST(
                ROUND((available.retail_price*(1-$8::numeric/100))::numeric,2),
                ROUND(COALESCE(available.minimum_sale_price,available.retail_price)::numeric,2)
              )
            END) AS minimum_available_price
          FROM (
            SELECT po.minimum_sale_price,
              CASE WHEN po.price_mode='MANUAL' AND po.manual_retail_price IS NOT NULL
                THEN po.manual_retail_price ELSE po.retail_price END AS retail_price
            FROM product_offers po
            LEFT JOIN warehouses w ON w.id=po.warehouse_id
            LEFT JOIN suppliers s ON s.id=COALESCE(po.supplier_id,w.supplier_id)
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(sr.quantity),0) AS reserved_quantity
              FROM stock_reservations sr
              WHERE sr.product_offer_id=po.id
                AND (sr.status='ORDER_PENDING' OR (sr.status='ACTIVE'
                  AND (sr.order_id IS NOT NULL OR sr.reserved_until IS NULL
                    OR sr.reserved_until>CURRENT_TIMESTAMP)))
            ) reservations ON TRUE
            WHERE po.product_id=p.id AND po.is_available=TRUE AND po.is_hidden=FALSE
              AND GREATEST(po.quantity-COALESCE(reservations.reserved_quantity,0),0)>0
              AND (w.id IS NULL OR w.is_active=TRUE)
              AND (s.id IS NULL OR s.is_active=TRUE)
              AND (CASE WHEN po.price_mode='MANUAL' AND po.manual_retail_price IS NOT NULL
                THEN po.manual_retail_price ELSE po.retail_price END)>0
          ) available
          HAVING COUNT(*)>0
        ) offer_metrics ON TRUE
        WHERE p.is_active=TRUE
          AND EXISTS (
            SELECT 1 FROM visible_assignments assignment
            JOIN category_scope scope ON scope.id=assignment.category_id
            WHERE assignment.product_id=p.id
          )
          AND (
            NULLIF($3::text,'') IS NULL
            OR POSITION(LOWER($3) IN LOWER(COALESCE(requested_translation.name,default_translation.name,p.name)))>0
            OR POSITION(LOWER($3) IN LOWER(p.article))>0
            OR (NULLIF($4::text,'') IS NOT NULL AND POSITION($4 IN p.article_normalized)>0)
          )
      ),
      filtered_products AS (
        SELECT * FROM product_metrics
        WHERE ($5::text='all'
          OR ($5::text='available' AND has_available_offer)
          OR ($5::text='unavailable' AND NOT has_available_offer))
          AND ($6::numeric IS NULL OR minimum_available_price >= $6::numeric)
          AND ($7::numeric IS NULL OR minimum_available_price <= $7::numeric)
      )
    `;
    const filterParameters = [row.id, locale, normalizedQuery, normalizedArticleQuery,
      normalizedAvailability, normalizedMinPrice, normalizedMaxPrice, discountPercent, isVip];
    const [countResult, productResult, childrenResult] = await Promise.all([
      db.query(`${filteredProductsSql}
        SELECT COUNT(*)::integer AS count FROM filtered_products`, filterParameters),
      db.query(`${filteredProductsSql}
      SELECT p.id, p.article, p.article_normalized,
             filtered.display_name AS name,
             filtered.name_provider,
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
      FROM filtered_products filtered
      JOIN products p ON p.id=filtered.id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN part_manufacturers pm ON pm.id = p.manufacturer_id
      ORDER BY ${orderSql}
      LIMIT $10 OFFSET $11`, [...filterParameters, limit, (normalizedPage - 1) * limit]),
      db.query(`
        WITH RECURSIVE direct_children AS (
          SELECT id
          FROM categories
          WHERE parent_id = $1 AND is_active = TRUE
        ),
        child_scope(root_child_id, category_id) AS (
          SELECT id, id FROM direct_children
          UNION ALL
          SELECT scope.root_child_id, child.id
          FROM child_scope scope
          JOIN categories child
            ON child.parent_id = scope.category_id
            AND child.is_active = TRUE
        ),
        visible_assignments AS (
          SELECT assignment.product_id, assignment.category_id
          FROM product_categories assignment
          WHERE assignment.assignment_source = 'MANUAL'
            OR (
              assignment.assignment_source = 'AUTO_RULE'
              AND NOT EXISTS (
                SELECT 1
                FROM product_categories manual_assignment
                WHERE manual_assignment.product_id = assignment.product_id
                  AND manual_assignment.assignment_source = 'MANUAL'
                  AND NOT category_is_within_tree(
                    manual_assignment.category_id,
                    'mb-accessories-b'
                  )
              )
            )
            OR (
              assignment.assignment_source = 'ACCESSORY_RULE'
              AND NOT EXISTS (
                SELECT 1
                FROM product_categories manual_assignment
                WHERE manual_assignment.product_id = assignment.product_id
                  AND manual_assignment.assignment_source = 'MANUAL'
                  AND category_is_within_tree(
                    manual_assignment.category_id,
                    'mb-accessories-b'
                  )
              )
            )
        ),
        child_counts AS (
          SELECT scope.root_child_id,
                 COUNT(DISTINCT assignment.product_id)::integer AS product_count
          FROM child_scope scope
          JOIN visible_assignments assignment ON assignment.category_id = scope.category_id
          JOIN products product ON product.id = assignment.product_id AND product.is_active = TRUE
          GROUP BY scope.root_child_id
        )
        SELECT
          child.id,
          child.slug,
          child.name,
          child.name_uk,
          child.name_ru,
          child.name_en,
          COALESCE(child_counts.product_count, 0)::integer AS product_count
        FROM categories child
        LEFT JOIN child_counts ON child_counts.root_child_id = child.id
        WHERE child.parent_id = $1
          AND child.is_active = TRUE
        ORDER BY child.sort_order, child.id
      `, [row.id]),
    ]);
    const products = await Promise.all(productResult.rows.map(async (product) => {
      const name = publicProductName(product.name, product.name_provider);
      const image = ProductPlaceholderService.getProductImage({
        ...product,
        name,
        category: localizedName(row, locale),
        imageUrl: product.image_url,
        imageUrls: product.image_urls,
      });
      return {
        ...product,
        name,
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
        children: childrenResult.rows
          .filter((child) => Number(child.product_count) > 0)
          .map((child) => ({
            id: Number(child.id),
            slug: child.slug,
            name: localizedName(child, locale),
            productCount: Number(child.product_count),
          })),
      },
      products,
      pagination: { page: normalizedPage, pageSize: limit, total: Number(countResult.rows[0].count),
        pages: Math.max(1, Math.ceil(Number(countResult.rows[0].count) / limit)) },
      filters: {
        query: normalizedQuery,
        availability: normalizedAvailability,
        minPrice: normalizedMinPrice,
        maxPrice: normalizedMaxPrice,
        sort: normalizedSort,
      },
    };
  },
};
