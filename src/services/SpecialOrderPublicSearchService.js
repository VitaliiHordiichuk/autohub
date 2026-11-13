import { specialOrderArticle } from "./SpecialOrderArticlePolicy.js";
import { calculateSpecialOrderPrice } from "./SpecialOrderPricingService.js";

// This is NOT a product_offers row. TXT has no sellable inventory and must
// never produce an offer ID, positive quantity or checkout permission.
// A second condition (the activated revision pointer) is required in addition
// to the explicit feature flag. No active pointer => no public TXT result.
const SOURCE_KEY = "mercedes-txt";

// The public TXT price policy is independent of ordinary MAKA warehouse
// discounts, VIP minimum-price mode, and individualized discounts.
// This is the EXPLICIT supplier-group allowlist approved for customers.
// The importer may recognize additional codes, but those codes MUST NOT
// become publicly visible via the TXT fallback.
const PUBLIC_TXT_DISCOUNT_GROUPS = new Set([
  "00", "03", "05", "08", "09",
  "10", "13", "13s", "16", "16s", "17", "18", "20", "20s", "23",
  "26", "28", "30", "30s", "32", "35", "38", "38s", "40", "40s",
  "43", "46", "50", "52", "54",
  ...Array.from({ length: 18 }, (_, index) => String(index + 55)),
]);

const PUBLIC_LABELS = Object.freeze({
  uk: "Ціна та строк постачання потребують підтвердження",
  ru: "Цена и срок поставки требуют подтверждения",
  en: "Price and delivery time require confirmation",
});

export function txtPublicSearchEnabled(env = process.env) {
  return env.MAKA_TXT_PUBLIC_SEARCH_ENABLED === "true";
}

// Only the active READY revision is queried. LIMIT 2 intentionally rejects
// ALL ambiguous normalized article numbers, including same-price duplicates.
// There is no broad text search over 1.5 million TXT entries.
export const ACTIVE_TXT_ARTICLE_SQL = `
  SELECT
    e.article,
    e.article_normalized,
    e.title,
    e.discount_group,
    e.retail_ex_vat_uah,
    r.id AS import_id
  FROM special_order_sources s
  JOIN special_order_import_runs r
    ON r.id = s.active_import_id
   AND r.source_key = s.source_key
   AND r.status = 'READY'
  JOIN special_order_entries e
    ON e.import_id = r.id
  WHERE s.source_key = 'mercedes-txt'
    AND e.article_normalized = $1
  ORDER BY e.line_number ASC
  LIMIT 2
`;

export async function readSpecialOrderPublicOffer({
  article,
  pricingContext,
  requestedLocale = "uk",
  enabled = txtPublicSearchEnabled(),
}, deps = {}) {
  // Strict opt-in, including before opening the PostgreSQL pool.
  if (enabled !== true) return null;
  const valid = specialOrderArticle(article);
  if (!valid) return null;
  const db = deps.db || (await import("../config/db.js")).pool;
  const rows = (await db.query(ACTIVE_TXT_ARTICLE_SQL, [valid.normalized])).rows;
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  if (row.article_normalized !== valid.normalized) return null;
  const importId = Number(row.import_id);
  if (!Number.isSafeInteger(importId) || importId <= 0) return null;
  // Fail closed for a missing customer context; never silently treat an
  // unknown session as a guest. Only named GOLD/VIP groups get supplier
  // premium pricing. Ordinary MAKA discountPercent/isVip are NOT used.
  if (typeof pricingContext?.priceGroupName !== "string" ||
      !pricingContext.priceGroupName.trim()) return null;
  const supplierGroup = typeof row.discount_group === "string"
    ? row.discount_group.trim().toLowerCase() : null;
  if (!PUBLIC_TXT_DISCOUNT_GROUPS.has(supplierGroup)) return null;
  const price = calculateSpecialOrderPrice({
    retailPriceExVatUah: row.retail_ex_vat_uah,
    secondDiscountGroup: supplierGroup,
    priceGroupName: pricingContext.priceGroupName,
  });
  if (!price) return null;

  const locale = Object.hasOwn(PUBLIC_LABELS, requestedLocale)
    ? requestedLocale : "uk";
  // Public read model only. Not an OfferService offer; cannot go to cart.
  return {
    sourceType: "SPECIAL_ORDER",
    sourceKey: SOURCE_KEY,
    importId,
    article: String(row.article),
    articleNormalized: valid.normalized,
    title: row.title ? String(row.title).slice(0, 250) : null,
    indicativePriceUah: price.articlePriceUah,
    currency: "UAH",
    availabilityStatus: "ON_REQUEST",
    availabilityText: PUBLIC_LABELS[locale],
    quantity: null,
    isAvailable: false,
    checkoutEnabled: false,
    requiresConfirmation: true,
  };
}
