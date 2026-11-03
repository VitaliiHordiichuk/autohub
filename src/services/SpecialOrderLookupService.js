import { pool } from "../config/db.js";
import { normalizeArticle } from "./articleEngine/normalize.js";
import {
  calculateSpecialOrderPrice,
  specialOrderAllowedGroups,
} from "./SpecialOrderPricingService.js";

const SOURCE_KEY = "mercedes-txt";

/**
 * Lookup candidates only. The caller must invoke this ONLY after confirming
 * that neither MAKA nor a partner has an eligible, available offer.
 *
 * The importer must load a complete revision, validate it, mark it READY,
 * and atomically update special_order_sources.active_import_id.
 *
 * This method does not create a product, public page, cart item or order.
 */
export async function lookupSpecialOrderArticle({
  article,
  priceGroupName = "Guest",
  db = pool,
}) {
  const normalized = normalizeArticle(article);
  if (!/^[A-Z0-9]{2,120}$/.test(normalized)) return [];

  const result = await db.query(
    `SELECT e.article, e.title, e.discount_group, e.retail_ex_vat_uah
     FROM special_order_sources AS s
     JOIN special_order_import_runs AS i
       ON i.id = s.active_import_id
       AND i.source_key = s.source_key
       AND i.status = 'READY'
     JOIN special_order_entries AS e
       ON e.import_id = i.id
     WHERE s.source_key = $1
       AND e.article_normalized = $2
       AND e.discount_group = ANY($3::varchar[])
     ORDER BY e.retail_ex_vat_uah ASC, e.line_number ASC
     LIMIT 20`,
    [SOURCE_KEY, normalized, specialOrderAllowedGroups()]
  );

  return result.rows.flatMap(row => {
    const pricing = calculateSpecialOrderPrice({
      retailPriceExVatUah: row.retail_ex_vat_uah,
      secondDiscountGroup: row.discount_group,
      priceGroupName,
    });
    if (!pricing) return [];
    return [{
      article: row.article,
      name: String(row.title || "").trim() || null,
      status: "SPECIAL_ORDER_INQUIRY",
      priceUah: pricing.articlePriceUah,
      currency: "UAH",
      // Does not confirm availability, delivery or a binding sale price.
      requiresManagerConfirmation: true,
    }];
  });
}
