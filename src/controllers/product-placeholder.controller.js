import { pool } from "../config/db.js";
import { ProductPlaceholderService } from "../services/ProductPlaceholderService.js";
import { normalizeArticle } from "../services/articleEngine/normalize.js";
import { effectiveProductCategoryQuery } from "../services/EffectiveProductCategoryService.js";
import { publicProductName } from "../services/ProductNameService.js";

async function findProduct(article) {
  const normalized = normalizeArticle(article);
  if (!normalized) return null;

  const result = await pool.query(`
    SELECT
      p.article,
      p.article_normalized,
      p.name,
      CASE WHEN EXISTS (
        SELECT 1
        FROM product_translations manual_name
        WHERE manual_name.product_id = p.id
          AND manual_name.provider = 'MANUAL'
          AND manual_name.name = p.name
      ) THEN 'MANUAL' ELSE NULL END AS name_provider,
      COALESCE(b.name, pm.name) AS brand,
      pt.name AS product_type,
      CONCAT_WS(
        ' ',
        effective_category.name,
        effective_category.name_uk,
        effective_category.name_ru,
        effective_category.name_en
      ) AS category
    FROM products p
    LEFT JOIN LATERAL (
      ${effectiveProductCategoryQuery("p")}
    ) effective_category ON TRUE
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

  const product = result.rows[0] || null;
  if (product) product.name = publicProductName(product.name, product.name_provider);
  return product;
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
