import { pool } from "../config/db.js";

function mapProduct(row) {
  return {
    id: Number(row.id),
    article: row.article,
    articleNormalized: row.article_normalized,
    name: row.name,
    translations: row.translations || [],
    technicalEpcGroups: row.technical_epc_group
      ? [String(row.technical_epc_group)]
      : [],
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
    assignedAt: row.assigned_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by === null ? null : Number(row.approved_by),
    updatedAt: row.updated_at,
  };
}

function mapCategory(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: row.slug,
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    parentSlug: row.parent_slug,
    status: row.status,
    isActive: Boolean(row.is_active),
  };
}

function mapRule(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code,
    version: Number(row.version),
    detectorVersion: Number(row.detector_version),
    sourceKind: row.source_kind,
    assignmentRole: row.assignment_role,
    numberFamily: row.number_family,
    epcGroup: row.epc_group,
    matchType: row.match_type,
    matchValue: row.match_value,
    excludeValues: row.exclude_values || [],
    targetCategoryId: Number(row.target_category_id),
    targetCategorySlug: row.target_category_slug,
    targetParentId: row.target_parent_id === null
      ? null
      : Number(row.target_parent_id),
    targetParentSlug: row.target_parent_slug,
    targetStatus: row.target_status,
    targetIsActive: Boolean(row.target_is_active),
    priority: Number(row.priority),
    confidence: row.confidence,
    autoApprovalAllowed: Boolean(row.auto_approval_allowed),
    isActive: Boolean(row.is_active),
  };
}

export const CustomerTaxonomyPhase3CSteeringUpgradeRepository = {
  async lockTargetProducts(articles, db = pool) {
    const result = await db.query(`
      SELECT product.id
      FROM products product
      WHERE product.article_normalized = ANY($1::text[])
      ORDER BY product.id
      FOR UPDATE
    `, [articles]);
    return result.rows.map((row) => Number(row.id));
  },

  async listTargetProducts(articles, db = pool) {
    const result = await db.query(`
      SELECT
        product.id,
        product.article,
        product.article_normalized,
        product.name,
        CASE
          WHEN COALESCE(product.article_normalized, product.article, '')
            ~ '^A[0-9]{10}'
          THEN SUBSTRING(
            COALESCE(product.article_normalized, product.article, '')
            FROM 5 FOR 2
          )
          ELSE NULL
        END AS technical_epc_group,
        COALESCE((
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'languageCode', translation.language_code,
              'name', translation.name
            )
            ORDER BY translation.language_code
          )
          FROM product_translations translation
          WHERE translation.product_id = product.id
            AND NULLIF(BTRIM(translation.name), '') IS NOT NULL
        ), '[]'::JSONB) AS translations
      FROM products product
      WHERE product.article_normalized = ANY($1::text[])
      ORDER BY product.article_normalized, product.id
    `, [articles]);
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
      SELECT category.*, parent.slug AS parent_slug
      FROM customer_categories category
      LEFT JOIN customer_categories parent ON parent.id = category.parent_id
      WHERE category.slug = $1
    `, [slug]);
    return mapCategory(result.rows[0]);
  },

  async getRule({ code, version }, db = pool) {
    const result = await db.query(`
      SELECT
        rule.*,
        category.slug AS target_category_slug,
        category.parent_id AS target_parent_id,
        category.status AS target_status,
        category.is_active AS target_is_active,
        parent.slug AS target_parent_slug
      FROM customer_classification_rules rule
      JOIN customer_categories category ON category.id = rule.target_category_id
      LEFT JOIN customer_categories parent ON parent.id = category.parent_id
      WHERE rule.code = $1 AND rule.version = $2
    `, [code, version]);
    return mapRule(result.rows[0]);
  },

  async upgradeMembershipInPlace({
    productId,
    currentCategoryId,
    targetCategoryId,
    ruleCode,
    ruleVersion,
  }, db = pool) {
    const result = await db.query(`
      UPDATE product_customer_categories
      SET
        customer_category_id = $3,
        is_primary = TRUE,
        assignment_source = 'RULE',
        assignment_origin = 'BACKFILL',
        rule_code = $4,
        rule_version = $5,
        confidence = 'HIGH',
        approval_status = 'AUTO_APPROVED',
        assigned_at = NOW(),
        approved_at = NOW(),
        approved_by = NULL,
        updated_at = NOW()
      WHERE product_id = $1
        AND customer_category_id = $2
      RETURNING *
    `, [
      productId,
      currentCategoryId,
      targetCategoryId,
      ruleCode,
      ruleVersion,
    ]);
    return result.rows[0] || null;
  },

  async getGlobalIntegrity(db = pool) {
    const result = await db.query(`
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM (
            SELECT membership.product_id
            FROM product_customer_categories membership
            WHERE membership.is_primary = TRUE
            GROUP BY membership.product_id
            HAVING COUNT(*) > 1
          ) duplicate
        ) AS duplicate_primary,
        COUNT(*) FILTER (
          WHERE membership.rule_code IS NOT NULL AND rule.id IS NULL
        )::integer AS orphan_rule,
        COUNT(*) FILTER (
          WHERE category.status <> 'ACTIVE' OR category.is_active IS NOT TRUE
        )::integer AS inactive_target
      FROM product_customer_categories membership
      JOIN customer_categories category
        ON category.id = membership.customer_category_id
      LEFT JOIN customer_classification_rules rule
        ON rule.code = membership.rule_code
       AND rule.version = membership.rule_version
    `);
    return {
      duplicatePrimary: Number(result.rows[0].duplicate_primary),
      orphanRule: Number(result.rows[0].orphan_rule),
      inactiveTarget: Number(result.rows[0].inactive_target),
    };
  },
};
