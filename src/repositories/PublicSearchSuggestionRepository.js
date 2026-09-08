import { pool } from "../config/db.js";
import { normalizeArticle } from "../services/articleEngine/normalize.js";
import { ProductPlaceholderService } from "../services/ProductPlaceholderService.js";
import { publicProductName } from "../services/ProductNameService.js";
import { cleanPublicSearchQuery, escapeSearchLike, isArticleQuery, publicSearchTerms } from "../services/PublicSearchQuery.js";

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

// Suggestions and submitted text searches share exactly the same matching SQL.
async function find({ query, locale = "uk", limit = 24, page = 1, withTotal = true }, db) {
  const rawQuery = cleanPublicSearchQuery(query);
  const terms = publicSearchTerms(rawQuery);
  const safeLocale = ["uk", "en", "ru"].includes(locale) ? locale : "uk";
  const safeLimit = positiveInteger(limit, 24, 48);
  const safePage = positiveInteger(page, 1, 100000);
  const empty = { products: [], pagination: { page: safePage, pageSize: safeLimit, pages: 1, total: 0 } };
  if (!rawQuery || !terms.length) return empty;
  // Cyrillic words must not reduce to Latin lookalikes matching random articles.
  const article = isArticleQuery(rawQuery) ? normalizeArticle(rawQuery) : "";
  const params = [safeLocale, article, escapeSearchLike(rawQuery), ...terms];
  const textMatch = terms.map((_, index) => `(
    p.name ILIKE ANY($${index + 4}::text[])
    OR COALESCE(b.name, pm.name, '') ILIKE ANY($${index + 4}::text[])
    OR EXISTS (
      SELECT 1 FROM product_translations pt
      WHERE pt.product_id = p.id AND pt.name ILIKE ANY($${index + 4}::text[])
    )
  )`).join(" AND ");
  const from = `FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN part_manufacturers pm ON pm.id = p.manufacturer_id`;
  const where = `WHERE p.is_active = TRUE AND (
    ($2 <> '' AND p.article_normalized LIKE '%' || $2 || '%')
    OR p.article ILIKE '%' || $3 || '%'
    OR (${textMatch})
  )`;
  const [result, count] = await Promise.all([
    db.query(`SELECT p.id, p.article, p.article_normalized,
      COALESCE(requested_translation.name, default_translation.name, p.name) AS name,
      CASE
        WHEN requested_translation.name IS NOT NULL THEN requested_translation.provider
        WHEN default_translation.name IS NOT NULL THEN default_translation.provider
        WHEN EXISTS (SELECT 1 FROM product_translations manual_name
          WHERE manual_name.product_id=p.id AND manual_name.provider='MANUAL' AND manual_name.name=p.name)
          THEN 'MANUAL'
        ELSE NULL
      END AS name_provider,
      COALESCE(b.name, pm.name, '') AS manufacturer,
      (SELECT pi.url FROM product_images pi WHERE pi.product_id=p.id ORDER BY pi.priority, pi.id LIMIT 1) AS image_url
      ${from}
      LEFT JOIN product_translations requested_translation
        ON requested_translation.product_id=p.id AND requested_translation.language_code=$1
      LEFT JOIN LATERAL (
        SELECT sl.code FROM site_languages sl
        WHERE sl.is_public_enabled=TRUE AND sl.is_default=TRUE ORDER BY sl.sort_order, sl.code LIMIT 1
      ) default_language ON TRUE
      LEFT JOIN product_translations default_translation
        ON default_translation.product_id=p.id AND default_translation.language_code=default_language.code
      ${where}
      ORDER BY
        CASE WHEN p.article_normalized=$2 THEN 0 ELSE 1 END,
        CASE WHEN EXISTS (
          SELECT 1 FROM product_offers po
          LEFT JOIN warehouses w ON w.id=po.warehouse_id
          LEFT JOIN suppliers s ON s.id=COALESCE(po.supplier_id,w.supplier_id)
          WHERE po.product_id=p.id AND po.is_available=TRUE AND po.is_hidden=FALSE
            AND (w.id IS NULL OR w.is_active=TRUE) AND (s.id IS NULL OR s.is_active=TRUE)
            AND po.quantity > COALESCE((SELECT SUM(sr.quantity) FROM stock_reservations sr
              WHERE sr.product_offer_id=po.id AND (sr.status='ORDER_PENDING' OR (sr.status='ACTIVE'
                AND (sr.order_id IS NOT NULL OR sr.reserved_until IS NULL OR sr.reserved_until>CURRENT_TIMESTAMP)))),0)
        ) THEN 0 ELSE 1 END,
        CASE WHEN EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id=p.id) THEN 0 ELSE 1 END,
        CASE WHEN p.article_normalized LIKE $2 || '%' AND $2 <> '' THEN 0 ELSE 1 END,
        p.article, p.id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, safeLimit, (safePage - 1) * safeLimit]),
    withTotal ? db.query(`SELECT COUNT(*)::integer AS total ${from} ${where}
      AND $1::text IS NOT NULL`, params) : Promise.resolve(null),
  ]);
  const total = count ? Number(count.rows[0].total) : result.rows.length;
  const products = result.rows.map(row => {
    const name = publicProductName(row.name, row.name_provider);
    const image = ProductPlaceholderService.getProductImage({ ...row, name, imageUrl: row.image_url });
    return {
      id: Number(row.id), article: row.article, normalized: row.article_normalized,
      name, manufacturer: row.manufacturer || null,
      imageUrl: image.imageUrl, hasRealImage: image.hasRealImage, isPlaceholder: image.isPlaceholder,
    };
  });
  return { products, pagination: { page: safePage, pageSize: safeLimit, total, pages: Math.max(1, Math.ceil(total / safeLimit)) } };
}

export const PublicSearchSuggestionRepository = {
  async list({ query = "", locale = "uk", limit = 8 } = {}, db = pool) {
    const result = await find({ query, locale, limit: positiveInteger(limit, 8, 12), withTotal: false }, db);
    return result.products;
  },
  search({ query = "", locale = "uk", page = 1 } = {}, db = pool) {
    return find({ query, locale, page }, db);
  },
};
