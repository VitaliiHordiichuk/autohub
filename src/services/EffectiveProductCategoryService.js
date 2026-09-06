import { pool } from "../config/db.js";

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
    ORDER BY
      CASE WHEN assignment.assignment_source = 'MANUAL' THEN 0 ELSE 1 END,
      CASE WHEN assignment.assignment_source = 'ACCESSORY_RULE' THEN 1 ELSE 0 END,
      CASE WHEN category.parent_id IS NOT NULL THEN 0 ELSE 1 END,
      assignment.confidence DESC NULLS LAST,
      category.sort_order,
      category.id
    LIMIT 1
  `;
}

export const EffectiveProductCategoryService = {
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
