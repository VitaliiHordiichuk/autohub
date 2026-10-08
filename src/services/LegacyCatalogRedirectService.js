import { pool } from "../config/db.js";
import { isCustomerTaxonomyPublicEnabled } from "../config/featureFlags.js";

// Reviewed system-level replacements only. Mixed EPC groups must not be
// redirected to whichever customer root happens to contain most products.
export const LEGACY_CATALOG_REDIRECTS = Object.freeze({
  "mb-group-42": "brakes",
  "mb-group-43": "brakes",
  "mb-group-46": "steering",
  "mb-group-49": "exhaust",
});

export const LegacyCatalogRedirectService = {
  async resolve(slug, db = pool) {
    if (!isCustomerTaxonomyPublicEnabled()) return null;
    if (!Object.hasOwn(LEGACY_CATALOG_REDIRECTS, slug)) return null;
    const target = LEGACY_CATALOG_REDIRECTS[slug];
    const result = await db.query(`
      SELECT id FROM customer_categories
      WHERE slug = $1 AND parent_id IS NULL AND status = 'ACTIVE' AND is_active = TRUE
    `, [target]);
    return result.rowCount === 1 ? { slug: target, status: 301 } : null;
  },
};
