import { pool } from "../config/db.js";
import { ProductPlaceholderService } from "../services/ProductPlaceholderService.js";
import { normalizeArticle } from "../services/articleEngine/normalize.js";

async function findProduct(article) {
  const normalized = normalizeArticle(article);
  if (!normalized) return null;

  const result = await pool.query(`
    SELECT
      p.article,
      p.article_normalized,
      p.name,
      COALESCE(b.name, pm.name) AS brand,
      pt.name AS product_type,
      (
        SELECT STRING_AGG(
          CONCAT_WS(' ', c.name, c.name_uk, c.name_ru, c.name_en),
          ' '
        )
        FROM product_categories pc
        JOIN categories c ON c.id = pc.category_id AND c.is_active = TRUE
        WHERE pc.product_id = p.id
      ) AS category
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN part_manufacturers pm ON pm.id = p.manufacturer_id
    LEFT JOIN product_types pt ON pt.id = p.product_type_id
    WHERE p.is_active = TRUE
      AND (
        p.article_normalized = $1
        OR UPPER(REGEXP_REPLACE(p.article, '[^A-Za-z0-9]', '', 'g')) = $1
      )
    ORDER BY CASE WHEN p.article_normalized = $1 THEN 0 ELSE 1 END, p.id
    LIMIT 1
  `, [normalized]);

  return result.rows[0] || null;
}

export async function getProductPlaceholder(req, res) {
  try {
    const product = await findProduct(req.params.article);
    if (!product) {
      return res.status(404).json({ success: false, error: "Товар не знайдено" });
    }

    const etag = ProductPlaceholderService.placeholderEtag(product);
    if (req.headers["if-none-match"] === etag) {
      res.set({
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        ETag: etag,
      });
      return res.status(304).end();
    }

    const rendered = await ProductPlaceholderService.generatePlaceholder(product);
    res.set({
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      "Content-Type": "image/webp",
      "Cross-Origin-Resource-Policy": "cross-origin",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    });
    return res.send(rendered.buffer);
  } catch (error) {
    console.error("Помилка генерації заглушки товару:", error);
    return res.status(500).json({ success: false, error: "Не вдалося створити зображення товару" });
  }
}
