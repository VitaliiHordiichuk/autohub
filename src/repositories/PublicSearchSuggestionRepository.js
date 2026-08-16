import { pool } from "../config/db.js";
import { normalizeArticle } from "../services/articleEngine/normalize.js";

function publicLocale(value) {
  const locale = String(value || "").toLowerCase();
  return ["uk", "en", "ru"].includes(locale) ? locale : "uk";
}

export const PublicSearchSuggestionRepository = {
  async list({ query = "", locale = "uk", limit = 8 } = {}, db = pool) {
    const rawQuery = String(query || "").trim();
    const normalizedQuery = normalizeArticle(rawQuery);
    const safeLocale = publicLocale(locale);
    const safeLimit = Math.min(12, Math.max(1, Number(limit) || 8));

    if (rawQuery.length < 2) return [];

    // Text-only queries (for example, a product name in Ukrainian) may not
    // produce an article-normalized value. Keep name/manufacturer matching
    // available without accidentally matching every article.
    const articleQuery = normalizedQuery || "__NO_ARTICLE_MATCH__";

    const result = await db.query(`
      SELECT
        p.id,
        p.article,
        p.article_normalized,
        COALESCE(requested_translation.name, default_translation.name, p.name) AS name,
        COALESCE(b.name, pm.name, '') AS manufacturer,
        image.url AS image_url
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN part_manufacturers pm ON pm.id = p.manufacturer_id
      LEFT JOIN product_translations requested_translation
        ON requested_translation.product_id = p.id
        AND requested_translation.language_code = $3
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
        SELECT pi.url
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.priority, pi.id
        LIMIT 1
      ) image ON TRUE
      WHERE p.is_active = TRUE
        AND (
          p.article_normalized ILIKE '%' || $1 || '%'
          OR p.article ILIKE '%' || $2 || '%'
          OR COALESCE(requested_translation.name, '') ILIKE '%' || $2 || '%'
          OR COALESCE(default_translation.name, '') ILIKE '%' || $2 || '%'
          OR p.name ILIKE '%' || $2 || '%'
          OR COALESCE(b.name, '') ILIKE '%' || $2 || '%'
          OR COALESCE(pm.name, '') ILIKE '%' || $2 || '%'
        )
      ORDER BY
        CASE
          WHEN p.article_normalized = $1 THEN 0
          WHEN p.article_normalized ILIKE $1 || '%' THEN 1
          WHEN p.article_normalized ILIKE '%' || $1 || '%' THEN 2
          WHEN COALESCE(requested_translation.name, '') ILIKE $2 || '%' THEN 3
          WHEN COALESCE(default_translation.name, '') ILIKE $2 || '%' THEN 4
          WHEN p.name ILIKE $2 || '%' THEN 5
          ELSE 6
        END,
        LENGTH(p.article_normalized),
        p.article,
        p.id
      LIMIT $4
    `, [articleQuery, rawQuery, safeLocale, safeLimit]);

    return result.rows.map((row) => ({
      id: Number(row.id),
      article: row.article,
      normalized: row.article_normalized,
      name: row.name,
      manufacturer: row.manufacturer || null,
      imageUrl: row.image_url || null,
    }));
  },
};
