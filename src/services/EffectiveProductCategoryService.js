import { pool } from "../config/db.js";
import { isCustomerTaxonomyPublicEnabled } from "../config/featureFlags.js";

function safeAlias(value, fallback) {
  const alias = String(value || "");
  return /^[a-z_][a-z0-9_]*$/i.test(alias) ? alias : fallback;
}

export function effectiveProductCategoryQuery(productAlias = "product") {
  const product = safeAlias(productAlias, "product");

  return `
    SELECT
      category.id,
      category.parent_id,
      category.slug,
      category.name,
      category.name_uk,
      category.name_ru,
      category.name_en,
      category.sort_order,
      assignment.assignment_source,
      assignment.confidence
    FROM product_categories assignment
    JOIN categories category
      ON category.id = assignment.category_id
      AND category.is_active = TRUE
    WHERE assignment.product_id = ${product}.id
      AND (
        assignment.assignment_source = 'MANUAL'
        OR (
          assignment.assignment_source = 'AUTO_RULE'
          AND NOT EXISTS (
            SELECT 1
            FROM product_categories manual_assignment
            WHERE manual_assignment.product_id = ${product}.id
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
            WHERE manual_assignment.product_id = ${product}.id
              AND manual_assignment.assignment_source = 'MANUAL'
              AND category_is_within_tree(
                manual_assignment.category_id,
                'mb-accessories-b'
              )
          )
        )
      )
    ORDER BY
      CASE WHEN category_is_within_tree(category.id, 'mb-accessories-b') THEN 1 ELSE 0 END,
      CASE WHEN assignment.assignment_source = 'MANUAL' THEN 0 ELSE 1 END,
      CASE WHEN category.parent_id IS NOT NULL THEN 0 ELSE 1 END,
      assignment.confidence DESC NULLS LAST,
      category.sort_order,
      category.id
    LIMIT 1
  `;
}

export const EffectiveProductCategoryService = {
  // Public links must use the same taxonomy as the catalog. Technical EPC
  // callers (including placeholders) continue using the legacy query below.
  async getPublicByProductId(productId, db = pool) {
    if (!isCustomerTaxonomyPublicEnabled()) return this.getByProductId(productId, db);
    const result = await db.query(`
      SELECT category.id, category.parent_id, category.slug,
        uk.name AS name, uk.name AS name_uk, ru.name AS name_ru, en.name AS name_en,
        parent.slug AS parent_slug,
        parent_uk.name AS parent_name, parent_uk.name AS parent_name_uk,
        parent_ru.name AS parent_name_ru, parent_en.name AS parent_name_en
      FROM product_customer_categories membership
      JOIN customer_categories category ON category.id = membership.customer_category_id
        AND category.status = 'ACTIVE' AND category.is_active = TRUE
      LEFT JOIN customer_category_translations uk ON uk.category_id = category.id AND uk.language_code = 'uk'
      LEFT JOIN customer_category_translations ru ON ru.category_id = category.id AND ru.language_code = 'ru'
      LEFT JOIN customer_category_translations en ON en.category_id = category.id AND en.language_code = 'en'
      LEFT JOIN customer_categories parent ON parent.id = category.parent_id
        AND parent.status = 'ACTIVE' AND parent.is_active = TRUE
      LEFT JOIN customer_category_translations parent_uk ON parent_uk.category_id = parent.id AND parent_uk.language_code = 'uk'
      LEFT JOIN customer_category_translations parent_ru ON parent_ru.category_id = parent.id AND parent_ru.language_code = 'ru'
      LEFT JOIN customer_category_translations parent_en ON parent_en.category_id = parent.id AND parent_en.language_code = 'en'
      WHERE membership.product_id = $1 AND membership.is_primary = TRUE
        AND membership.approval_status IN ('AUTO_APPROVED', 'MANUAL_APPROVED')
        AND (category.parent_id IS NULL OR parent.id IS NOT NULL)
      LIMIT 1
    `, [productId]);
    return result.rows[0] || null;
  },

  async getByProductId(productId, db = pool) {
    const result = await db.query(`
      SELECT
        effective_category.*,
        parent.slug AS parent_slug,
        parent.name AS parent_name,
        parent.name_uk AS parent_name_uk,
        parent.name_ru AS parent_name_ru,
        parent.name_en AS parent_name_en
      FROM products product
      JOIN LATERAL (
        ${effectiveProductCategoryQuery("product")}
      ) effective_category ON TRUE
      LEFT JOIN categories parent
        ON parent.id = effective_category.parent_id
        AND parent.is_active = TRUE
      WHERE product.id = $1
      LIMIT 1
    `, [productId]);

    return result.rows[0] || null;
  },
};
