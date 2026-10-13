import { pool } from "../config/db.js";
import { normalizeArticle } from "./articleEngine/normalize.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { OfferService, selectPrimaryPublicOffer } from "./OfferService.js";
import { ProductPlaceholderService } from "./ProductPlaceholderService.js";
import { PublicProductImageService } from "./PublicProductImageService.js";
import { publicProductName } from "./ProductNameService.js";

export const RECENTLY_VIEWED_LIMIT = 12;
export const RECENTLY_VIEWED_DAYS = 30;

const MAX_ARTICLE_LENGTH = 150;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const RECENTLY_VIEWED_MAX_AGE_MS = RECENTLY_VIEWED_DAYS * 24 * 60 * 60 * 1000;

function normalizeLocale(value) {
  const locale = String(value || "").trim().toLowerCase();
  return ["uk", "en", "ru"].includes(locale) ? locale : "uk";
}

function normalizedArticle(value) {
  const article = String(value || "").trim();
  if (!article || article.length > MAX_ARTICLE_LENGTH) return null;
  const normalized = normalizeArticle(article);
  return normalized || null;
}

function viewedAtDate(value, now) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(String(value || ""));
  const time = date.getTime();
  if (!Number.isFinite(time) || time <= now.getTime() - RECENTLY_VIEWED_MAX_AGE_MS) {
    return null;
  }
  if (time > now.getTime() + MAX_FUTURE_SKEW_MS) return null;
  return time > now.getTime() ? now : date;
}

export function normalizeRecentlyViewedItems(items, now = new Date()) {
  if (!Array.isArray(items)) {
    throw Object.assign(new Error("Поле items має бути масивом"), { statusCode: 400 });
  }
  if (items.length > RECENTLY_VIEWED_LIMIT) {
    throw Object.assign(new Error(`Можна передати не більше ${RECENTLY_VIEWED_LIMIT} товарів`), {
      statusCode: 400,
    });
  }

  const byArticle = new Map();
  for (const item of items) {
    const article = normalizedArticle(item?.article);
    const viewedAt = viewedAtDate(item?.viewedAt, now);
    if (!article || !viewedAt) continue;
    const current = byArticle.get(article);
    if (!current || viewedAt > current.viewedAt) {
      byArticle.set(article, { article, viewedAt });
    }
  }

  return [...byArticle.values()]
    .sort((first, second) => second.viewedAt - first.viewedAt)
    .slice(0, RECENTLY_VIEWED_LIMIT);
}

async function loadProductRows({ productIds = [], articles = [], locale }, db = pool) {
  const safeLocale = normalizeLocale(locale);
  const ids = [...new Set(productIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const normalizedArticles = [...new Set(articles.map(normalizedArticle).filter(Boolean))];
  if (!ids.length && !normalizedArticles.length) return [];

  const where = ids.length
    ? "p.id = ANY($2::bigint[])"
    : "p.article_normalized = ANY($2::text[])";
  const values = [safeLocale, ids.length ? ids : normalizedArticles];
  const result = await db.query(`
    SELECT p.id, p.article, p.article_normalized,
      COALESCE(requested_translation.name, default_translation.name, p.name) AS name,
      CASE
        WHEN requested_translation.name IS NOT NULL THEN requested_translation.provider
        WHEN default_translation.name IS NOT NULL THEN default_translation.provider
        WHEN EXISTS (
          SELECT 1 FROM product_translations manual_name
          WHERE manual_name.product_id=p.id
            AND manual_name.provider='MANUAL'
            AND manual_name.name=p.name
        ) THEN 'MANUAL'
        ELSE NULL
      END AS name_provider,
      ARRAY(
        SELECT pi.url FROM product_images pi
        WHERE pi.product_id=p.id
        ORDER BY pi.priority, pi.id
      ) AS image_urls,
      ARRAY(
        SELECT ${PublicProductImageService.sql("pi")}
        FROM product_images pi
        WHERE pi.product_id=p.id
        ORDER BY pi.priority, pi.id
      ) AS image_variants
    FROM products p
    LEFT JOIN product_translations requested_translation
      ON requested_translation.product_id=p.id
      AND requested_translation.language_code=$1
    LEFT JOIN LATERAL (
      SELECT sl.code FROM site_languages sl
      WHERE sl.is_public_enabled=TRUE AND sl.is_default=TRUE
      ORDER BY sl.sort_order, sl.code
      LIMIT 1
    ) default_language ON TRUE
    LEFT JOIN product_translations default_translation
      ON default_translation.product_id=p.id
      AND default_translation.language_code=default_language.code
    WHERE p.is_active=TRUE AND ${where}
  `, values);
  return result.rows;
}

function selectOffer(offers) {
  const primary = selectPrimaryPublicOffer(offers);
  if (primary) return primary;
  return (offers || []).find((offer) => [
    "RESERVED",
    "RESERVED_FOR_YOU",
  ].includes(offer.availabilityStatus)) || null;
}

async function presentRows(rows, { locale, userId = null, availabilityContext = null }) {
  if (!rows.length) return [];
  const safeLocale = normalizeLocale(locale);
  const pricingContext = await CustomerPricingService.getContext(userId);
  const offersByProductId = await OfferService.getOffersByProductIds(
    rows.map((row) => Number(row.id)),
    pricingContext,
    safeLocale,
    availabilityContext,
  );

  return rows.map((row) => {
    const name = publicProductName(row.name, row.name_provider);
    const image = ProductPlaceholderService.getProductImage({
      ...row,
      name,
      imageUrls: row.image_urls,
      imageVariants: row.image_variants,
    });
    const offer = selectOffer(offersByProductId.get(Number(row.id)) || []);
    return {
      id: Number(row.id),
      article: row.article,
      name,
      imageUrl: image.imageUrl,
      imageVariant: image.imageVariant,
      price: offer?.retailPrice ?? null,
      isAvailable: offer?.isAvailable === true,
      availabilityStatus: offer?.availabilityStatus || "UNAVAILABLE",
    };
  });
}

async function cardsForEntries(entries, options) {
  const rows = await loadProductRows({
    productIds: entries.map((entry) => entry.productId).filter(Boolean),
    articles: entries.map((entry) => entry.article).filter(Boolean),
    locale: options.locale,
  });
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const byArticle = new Map(rows.map((row) => [row.article_normalized, row]));
  const resolvedEntries = entries
    .map((entry) => ({
      entry,
      row: entry.productId
        ? byId.get(Number(entry.productId))
        : byArticle.get(normalizedArticle(entry.article)),
    }))
    .filter(({ row }) => Boolean(row));
  const cards = await presentRows(resolvedEntries.map(({ row }) => row), options);
  return cards.map((card, index) => ({
    ...card,
    viewedAt: resolvedEntries[index].entry.viewedAt instanceof Date
      ? resolvedEntries[index].entry.viewedAt.toISOString()
      : new Date(resolvedEntries[index].entry.viewedAt).toISOString(),
  }));
}

async function accountEntries(userId, db = pool) {
  const result = await db.query(`
    SELECT product_id, viewed_at
    FROM client_recently_viewed_products
    WHERE user_id=$1
      AND viewed_at > CURRENT_TIMESTAMP - INTERVAL '${RECENTLY_VIEWED_DAYS} days'
    ORDER BY viewed_at DESC, id DESC
    LIMIT $2
  `, [userId, RECENTLY_VIEWED_LIMIT]);
  return result.rows.map((row) => ({
    productId: Number(row.product_id),
    viewedAt: row.viewed_at,
  }));
}

async function mergeAccountItems(userId, items) {
  const normalized = normalizeRecentlyViewedItems(items);
  if (!normalized.length) return;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Serialize updates for one client so simultaneous phone/desktop merges
    // cannot both retain a thirteenth row.
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const products = await loadProductRows({
      articles: normalized.map((item) => item.article),
      locale: "uk",
    }, db);
    const productsByArticle = new Map(products.map((row) => [row.article_normalized, Number(row.id)]));
    const resolved = normalized
      .map((item) => ({ ...item, productId: productsByArticle.get(item.article) }))
      .filter((item) => item.productId);

    if (resolved.length) {
      await db.query(`
        INSERT INTO client_recently_viewed_products(user_id, product_id, viewed_at)
        SELECT $1, incoming.product_id, incoming.viewed_at
        FROM UNNEST($2::bigint[], $3::timestamptz[])
          AS incoming(product_id, viewed_at)
        ON CONFLICT(user_id, product_id) DO UPDATE
        SET viewed_at=GREATEST(
          client_recently_viewed_products.viewed_at,
          EXCLUDED.viewed_at
        )
      `, [
        userId,
        resolved.map((item) => item.productId),
        resolved.map((item) => item.viewedAt),
      ]);
    }

    await db.query(`
      DELETE FROM client_recently_viewed_products
      WHERE user_id=$1
        AND viewed_at <= CURRENT_TIMESTAMP - INTERVAL '${RECENTLY_VIEWED_DAYS} days'
    `, [userId]);
    await db.query(`
      DELETE FROM client_recently_viewed_products history
      WHERE history.user_id=$1
        AND history.id NOT IN (
          SELECT kept.id
          FROM client_recently_viewed_products kept
          WHERE kept.user_id=$1
          ORDER BY kept.viewed_at DESC, kept.id DESC
          LIMIT $2
        )
    `, [userId, RECENTLY_VIEWED_LIMIT]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export const RecentlyViewedProductService = {
  async listPublicCards({ items, locale, userId = null, availabilityContext = null }) {
    const entries = normalizeRecentlyViewedItems(items);
    return cardsForEntries(entries, { locale, userId, availabilityContext });
  },

  async listAccount({ userId, locale, availabilityContext = null }) {
    const entries = await accountEntries(userId);
    return cardsForEntries(entries, {
      locale,
      userId,
      availabilityContext: availabilityContext || { userId, cartId: null },
    });
  },

  async mergeAccount({ userId, locale, items, availabilityContext = null }) {
    await mergeAccountItems(userId, items);
    return RecentlyViewedProductService.listAccount({
      userId,
      locale,
      availabilityContext,
    });
  },

  async clearAccount({ userId }) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      const result = await db.query(
        "DELETE FROM client_recently_viewed_products WHERE user_id=$1",
        [userId],
      );
      await db.query("COMMIT");
      return result.rowCount;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  },
};
