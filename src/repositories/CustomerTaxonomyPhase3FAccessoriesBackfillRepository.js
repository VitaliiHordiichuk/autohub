import { pool } from "../config/db.js";
import { CustomerTaxonomyRepository } from "./CustomerTaxonomyRepository.js";

function technicalEpcGroups(row) {
  const groups = new Set();
  if (row.technical_epc_group) groups.add(String(row.technical_epc_group));
  for (const category of row.technical_categories || []) {
    const match = String(category?.slug || "").match(/^mb-group-(\d{2})$/i);
    if (match) groups.add(match[1]);
  }
  return [...groups].sort();
}

function mapProduct(row) {
  return {
    id: Number(row.id),
    article: row.article,
    articleNormalized: row.article_normalized,
    name: row.name,
    isActive: row.is_active === true,
    technicalEpcGroups: technicalEpcGroups(row),
  };
}

function mapMembership(row) {
  return {
    productId: Number(row.product_id),
    customerCategoryId: Number(row.customer_category_id),
    categorySlug: row.category_slug,
    parentSlug: row.parent_slug,
    isPrimary: Boolean(row.is_primary),
    assignmentSource: row.assignment_source,
    assignmentOrigin: row.assignment_origin,
    ruleCode: row.rule_code,
    ruleVersion: row.rule_version === null ? null : Number(row.rule_version),
    confidence: row.confidence,
    approvalStatus: row.approval_status,
  };
}

export const CustomerTaxonomyPhase3FAccessoriesBackfillRepository = {
  async lockAllowlistedProducts(productIds, db = pool) {
    const result = await db.query(`
      SELECT product.id
      FROM products product
      WHERE product.id = ANY($1::integer[])
      ORDER BY product.id
      FOR UPDATE
    `, [productIds]);
    return result.rows.map((row) => Number(row.id));
  },

  async listAllowlistedProducts(productIds, db = pool) {
    const result = await db.query(`
      SELECT
        product.id,
        product.article,
        product.article_normalized,
        product.name,
        product.is_active,
        CASE
          WHEN COALESCE(product.article_normalized, product.article, '')
            ~ '^A[0-9]{10}'
          THEN SUBSTRING(
            COALESCE(product.article_normalized, product.article, '')
            FROM 5 FOR 2
          )
          ELSE NULL
        END AS technical_epc_group,
        COALESCE(
          JSONB_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'slug', category.slug
            )
          ) FILTER (WHERE category.id IS NOT NULL),
          '[]'::JSONB
        ) AS technical_categories
      FROM products product
      LEFT JOIN product_categories assignment
        ON assignment.product_id = product.id
      LEFT JOIN categories category
        ON category.id = assignment.category_id
      WHERE product.id = ANY($1::integer[])
      GROUP BY product.id
      ORDER BY product.id
    `, [productIds]);
    return result.rows.map(mapProduct);
  },

  async listMembershipsForProducts(productIds, db = pool, { lock = false } = {}) {
    if (!productIds.length) return [];
    const result = await db.query(`
      SELECT
        membership.*,
        category.slug AS category_slug,
        parent.slug AS parent_slug
      FROM product_customer_categories membership
      JOIN customer_categories category
        ON category.id = membership.customer_category_id
      LEFT JOIN customer_categories parent
        ON parent.id = category.parent_id
      WHERE membership.product_id = ANY($1::integer[])
      ORDER BY membership.product_id, membership.is_primary DESC,
               membership.customer_category_id
      ${lock ? "FOR UPDATE OF membership" : ""}
    `, [productIds]);
    return result.rows.map(mapMembership);
  },

  async getCategoryBySlug(slug, db = pool) {
    const result = await db.query(`
      SELECT id, slug, parent_id, status, is_active
      FROM customer_categories
      WHERE slug = $1
    `, [slug]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      slug: row.slug,
      parentId: row.parent_id === null ? null : Number(row.parent_id),
      status: row.status,
      isActive: Boolean(row.is_active),
    };
  },

  async getGlobalIntegrity(db = pool) {
    const result = await db.query(`
      SELECT COUNT(*)::integer AS duplicate_primary
      FROM (
        SELECT membership.product_id
        FROM product_customer_categories membership
        WHERE membership.is_primary = TRUE
        GROUP BY membership.product_id
        HAVING COUNT(*) > 1
      ) duplicate
    `);
    return {
      duplicatePrimary: Number(result.rows[0].duplicate_primary),
    };
  },

  lockProductForAssignment(productId, db = pool) {
    return CustomerTaxonomyRepository.lockProductForAssignment(productId, db);
  },

  listMembershipsForProduct(productId, db = pool, options = {}) {
    return CustomerTaxonomyRepository.listMembershipsForProduct(productId, db, options);
  },

  demoteAutomaticPrimary(productId, db = pool) {
    return CustomerTaxonomyRepository.demoteAutomaticPrimary(productId, db);
  },

  upsertMembership(input, db = pool) {
    return CustomerTaxonomyRepository.upsertMembership(input, db);
  },
};
