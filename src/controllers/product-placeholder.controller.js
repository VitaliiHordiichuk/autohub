import { pool } from "../config/db.js";
import { ProductPlaceholderService } from "../services/ProductPlaceholderService.js";
import { normalizeArticle } from "../services/articleEngine/normalize.js";
import { effectiveProductCategoryQuery } from "../services/EffectiveProductCategoryService.js";
import { publicProductName } from "../services/ProductNameService.js";
import { createProductImageStorage } from "../services/ProductImageService.js";
import { primaryImageAliasEnabled, readPrimaryImageAlias } from "../services/ProductPrimaryImageAliasService.js";

async function findProduct(article, db) {
  const normalized = normalizeArticle(article);
  if (!normalized) return null;

  const result = await db.query(`
    SELECT
      p.id,
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

const LEGACY_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";
const ALIAS_CACHE_CONTROL = "public, no-cache, must-revalidate";

function matchesEtag(value, etag) {
  return typeof value === "string" && value.split(",").some(candidate => {
    const tag = candidate.trim();
    return tag === "*" || tag === etag || tag === `W/${etag}`;
  });
}

export function createProductPlaceholderHandler({ db = pool, storageFactory = createProductImageStorage, logger = console } = {}) {
  return async function getProductPlaceholder(req, res) {
    let stableAlias = false;
    try {
      const product = await findProduct(req.params.article, db);
      if (!product) {
        return res.set("Cache-Control", "no-store").status(404).json({ success: false, error: "Товар не знайдено" });
      }

      stableAlias = primaryImageAliasEnabled(product);
      const realImage = stableAlias ? await readPrimaryImageAlias(product, db, storageFactory) : null;
      const cacheControl = stableAlias ? ALIAS_CACHE_CONTROL : LEGACY_CACHE_CONTROL;
      const etag = realImage?.etag || ProductPlaceholderService.placeholderEtag(product);
      if (matchesEtag(req.headers["if-none-match"], etag)) {
        res.set({
          "Cache-Control": cacheControl,
          ETag: etag,
        });
        return res.status(304).end();
      }

      const rendered = realImage || await ProductPlaceholderService.generatePlaceholder(product);
      res.set({
        "Cache-Control": cacheControl,
        "Content-Type": realImage?.contentType || "image/webp",
        "Cross-Origin-Resource-Policy": "cross-origin",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") return res.set("Content-Length", String(rendered.buffer.length)).end();
      return res.send(rendered.buffer);
    } catch (error) {
      logger.error("Помилка генерації заглушки товару:", error);
      res.set("Cache-Control", "no-store");
      if (stableAlias) return res.set("Retry-After", "60").status(503).json({ success: false, error: "Зображення тимчасово недоступне" });
      return res.status(500).json({ success: false, error: "Не вдалося створити зображення товару" });
    }
  };
}

export const getProductPlaceholder = createProductPlaceholderHandler();
