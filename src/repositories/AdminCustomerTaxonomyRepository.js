import { pool } from "../config/db.js";

function number(value) {
  return Number(value || 0);
}

function mapCategory(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    parentSlug: row.parent_slug || null,
    name: row.name,
    depth: Number(row.depth || 0),
    status: row.status,
    isActive: Boolean(row.is_active),
    navigationVisible: Boolean(row.is_navigation_visible),
    membershipCount: number(row.membership_count),
    primaryCount: number(row.primary_count),
    highCount: number(row.high_count),
    mediumCount: number(row.medium_count),
    lowCount: number(row.low_count),
    autoApprovedCount: number(row.auto_approved_count),
    reviewCount: number(row.review_count),
    manualApprovedCount: number(row.manual_approved_count),
  };
}

function mapProductRow(row) {
  return {
    productId: Number(row.product_id),
    article: row.article,
    name: row.product_name,
    numberFamily: row.number_family,
    technicalEpcGroup: row.technical_epc_group,
    technicalCategories: row.technical_categories || [],
    customerCategory: {
      id: Number(row.customer_category_id),
      slug: row.customer_category_slug,
      name: row.customer_category_name,
      parentId: row.customer_parent_id === null ? null : Number(row.customer_parent_id),
      parentSlug: row.customer_parent_slug,
      parentName: row.customer_parent_name,
    },
    assignmentSource: row.assignment_source,
    assignmentOrigin: row.assignment_origin,
    ruleCode: row.rule_code,
    ruleVersion: row.rule_version === null ? null : Number(row.rule_version),
    ruleNumberFamily: row.rule_number_family,
    ruleEpcGroup: row.rule_epc_group,
    confidence: row.confidence,
    approvalStatus: row.approval_status,
    isPrimary: Boolean(row.is_primary),
    assignedAt: row.assigned_at,
  };
}

const localizedTechnicalName = `CASE
  WHEN $1::text = 'ru' THEN COALESCE(category.name_ru, category.name_uk, category.name_en, category.name)
  WHEN $1::text = 'en' THEN COALESCE(category.name_en, category.name_uk, category.name_ru, category.name)
  ELSE COALESCE(category.name_uk, category.name_ru, category.name_en, category.name)
END`;

const technicalCategoriesCte = `technical AS (
  SELECT
    assignment.product_id,
    COALESCE(
      JSONB_AGG(
        DISTINCT JSONB_BUILD_OBJECT(
          'id', category.id,
          'slug', category.slug,
          'name', ${localizedTechnicalName},
          'assignmentSource', assignment.assignment_source
        )
      ) FILTER (WHERE category.id IS NOT NULL),
      '[]'::JSONB
    ) AS categories
  FROM product_categories assignment
  JOIN categories category ON category.id = assignment.category_id
  GROUP BY assignment.product_id
)`;

const productBaseCte = `base AS (
  SELECT
    product.id AS product_id,
    product.article,
    product.name AS product_name,
    CASE
      WHEN COALESCE(product.article_normalized, product.article, '') LIKE 'A%' THEN 'A'
      WHEN COALESCE(product.article_normalized, product.article, '') LIKE 'N%' THEN 'N'
      WHEN COALESCE(product.article_normalized, product.article, '') LIKE 'B%' THEN 'B'
      ELSE 'OTHER'
    END AS number_family,
    CASE
      WHEN COALESCE(product.article_normalized, product.article, '') ~ '^A[0-9]{6,}$'
      THEN SUBSTRING(COALESCE(product.article_normalized, product.article, '') FROM 5 FOR 2)
      ELSE NULL
    END AS technical_epc_group,
    COALESCE(technical.categories, '[]'::JSONB) AS technical_categories,
    membership.customer_category_id,
    category.slug AS customer_category_slug,
    category_name.name AS customer_category_name,
    parent.id AS customer_parent_id,
    parent.slug AS customer_parent_slug,
    parent_name.name AS customer_parent_name,
    membership.assignment_source,
    membership.assignment_origin,
    membership.rule_code,
    membership.rule_version,
    rule.number_family AS rule_number_family,
    rule.epc_group AS rule_epc_group,
    membership.confidence,
    membership.approval_status,
    membership.is_primary,
    membership.assigned_at
  FROM product_customer_categories membership
  JOIN products product ON product.id = membership.product_id
  JOIN customer_categories category ON category.id = membership.customer_category_id
  LEFT JOIN customer_categories parent ON parent.id = category.parent_id
  LEFT JOIN customer_classification_rules rule
    ON rule.code = membership.rule_code
   AND rule.version = membership.rule_version
  LEFT JOIN technical ON technical.product_id = product.id
  LEFT JOIN LATERAL (
    SELECT translation.name
    FROM customer_category_translations translation
    WHERE translation.category_id = category.id
    ORDER BY CASE translation.language_code
      WHEN $1::text THEN 0 WHEN 'uk' THEN 1 WHEN 'ru' THEN 2 WHEN 'en' THEN 3 ELSE 4
    END
    LIMIT 1
  ) category_name ON TRUE
  LEFT JOIN LATERAL (
    SELECT translation.name
    FROM customer_category_translations translation
    WHERE translation.category_id = parent.id
    ORDER BY CASE translation.language_code
      WHEN $1::text THEN 0 WHEN 'uk' THEN 1 WHEN 'ru' THEN 2 WHEN 'en' THEN 3 ELSE 4
    END
    LIMIT 1
  ) parent_name ON TRUE
)`;

export const AdminCustomerTaxonomyRepository = {
  async listTree(locale, db = pool) {
    const result = await db.query(`
      WITH RECURSIVE
      category_paths AS (
        SELECT category.id, 0 AS depth, category.sort_order AS root_sort
        FROM customer_categories category
        WHERE category.parent_id IS NULL
        UNION ALL
        SELECT child.id, parent_path.depth + 1, parent_path.root_sort
        FROM category_paths parent_path
        JOIN customer_categories child ON child.parent_id = parent_path.id
      ),
      category_closure AS (
        SELECT category.id AS ancestor_id, category.id AS descendant_id
        FROM customer_categories category
        UNION ALL
        SELECT closure.ancestor_id, child.id
        FROM category_closure closure
        JOIN customer_categories child ON child.parent_id = closure.descendant_id
      ),
      category_stats AS (
        SELECT
          closure.ancestor_id AS category_id,
          COUNT(membership.product_id)::integer AS membership_count,
          COUNT(membership.product_id) FILTER (WHERE membership.is_primary)::integer AS primary_count,
          COUNT(membership.product_id) FILTER (WHERE membership.confidence = 'HIGH')::integer AS high_count,
          COUNT(membership.product_id) FILTER (WHERE membership.confidence = 'MEDIUM')::integer AS medium_count,
          COUNT(membership.product_id) FILTER (WHERE membership.confidence = 'LOW')::integer AS low_count,
          COUNT(membership.product_id) FILTER (WHERE membership.approval_status = 'AUTO_APPROVED')::integer AS auto_approved_count,
          COUNT(membership.product_id) FILTER (WHERE membership.approval_status = 'REVIEW')::integer AS review_count,
          COUNT(membership.product_id) FILTER (WHERE membership.approval_status = 'MANUAL_APPROVED')::integer AS manual_approved_count
        FROM category_closure closure
        LEFT JOIN product_customer_categories membership
          ON membership.customer_category_id = closure.descendant_id
        GROUP BY closure.ancestor_id
      )
      SELECT
        category.id,
        category.slug,
        category.parent_id,
        parent.slug AS parent_slug,
        translation.name,
        path.depth,
        path.root_sort,
        category.status,
        category.is_active,
        category.is_navigation_visible,
        COALESCE(stats.membership_count, 0) AS membership_count,
        COALESCE(stats.primary_count, 0) AS primary_count,
        COALESCE(stats.high_count, 0) AS high_count,
        COALESCE(stats.medium_count, 0) AS medium_count,
        COALESCE(stats.low_count, 0) AS low_count,
        COALESCE(stats.auto_approved_count, 0) AS auto_approved_count,
        COALESCE(stats.review_count, 0) AS review_count,
        COALESCE(stats.manual_approved_count, 0) AS manual_approved_count
      FROM customer_categories category
      JOIN category_paths path ON path.id = category.id
      LEFT JOIN customer_categories parent ON parent.id = category.parent_id
      LEFT JOIN category_stats stats ON stats.category_id = category.id
      LEFT JOIN LATERAL (
        SELECT candidate.name
        FROM customer_category_translations candidate
        WHERE candidate.category_id = category.id
        ORDER BY CASE candidate.language_code
          WHEN $1::text THEN 0 WHEN 'uk' THEN 1 WHEN 'ru' THEN 2 WHEN 'en' THEN 3 ELSE 4
        END
        LIMIT 1
      ) translation ON TRUE
      ORDER BY path.root_sort, path.depth, category.sort_order, category.id
    `, [locale]);
    return result.rows.map(mapCategory);
  },

  async getIntegrity(db = pool) {
    const result = await db.query(`
      WITH membership_totals AS (
        SELECT
          COUNT(*)::integer AS memberships,
          COUNT(*) FILTER (WHERE membership.is_primary)::integer AS primary_count,
          COUNT(*) FILTER (WHERE membership.approval_status = 'AUTO_APPROVED')::integer AS auto_approved,
          COUNT(*) FILTER (WHERE membership.approval_status = 'REVIEW')::integer AS review,
          COUNT(*) FILTER (
            WHERE membership.rule_code IS NOT NULL AND rule.id IS NULL
          )::integer AS orphan_rules,
          COUNT(*) FILTER (
            WHERE category.status <> 'ACTIVE' OR category.is_active IS NOT TRUE
          )::integer AS inactive_targets
        FROM product_customer_categories membership
        JOIN customer_categories category ON category.id = membership.customer_category_id
        LEFT JOIN customer_classification_rules rule
          ON rule.code = membership.rule_code
         AND rule.version = membership.rule_version
      ),
      duplicate_primary AS (
        SELECT COUNT(*)::integer AS count
        FROM (
          SELECT product_id
          FROM product_customer_categories
          WHERE is_primary = TRUE
          GROUP BY product_id
          HAVING COUNT(*) > 1
        ) duplicate
      ),
      persisted_conflicts AS (
        SELECT COUNT(*)::integer AS count
        FROM (
          SELECT product_id
          FROM product_customer_categories
          WHERE approval_status = 'REVIEW'
          GROUP BY product_id
          HAVING COUNT(DISTINCT customer_category_id) > 1
        ) conflict
      )
      SELECT totals.*, duplicate.count AS duplicate_primary,
             conflicts.count AS conflicts
      FROM membership_totals totals
      CROSS JOIN duplicate_primary duplicate
      CROSS JOIN persisted_conflicts conflicts
    `);
    const row = result.rows[0] || {};
    return {
      memberships: number(row.memberships),
      primary: number(row.primary_count),
      autoApproved: number(row.auto_approved),
      review: number(row.review),
      conflicts: number(row.conflicts),
      duplicatePrimary: number(row.duplicate_primary),
      orphanRules: number(row.orphan_rules),
      inactiveTargets: number(row.inactive_targets),
    };
  },

  async searchProducts({
    locale,
    categorySlug,
    searchPattern,
    assignmentSource,
    assignmentOrigin,
    confidence,
    approvalStatus,
    ruleCode,
    numberFamily,
    epcGroup,
    page,
    pageSize,
  }, db = pool) {
    const parameters = [
      locale,
      categorySlug,
      searchPattern,
      assignmentSource,
      assignmentOrigin,
      confidence,
      approvalStatus,
      ruleCode,
      numberFamily,
      epcGroup,
    ];
    const common = `
      WITH RECURSIVE selected_categories AS (
        SELECT id FROM customer_categories WHERE slug = $2::text
        UNION ALL
        SELECT child.id
        FROM selected_categories selected
        JOIN customer_categories child ON child.parent_id = selected.id
      ),
      ${technicalCategoriesCte},
      ${productBaseCte},
      filtered AS (
        SELECT * FROM base
        WHERE ($2::text IS NULL OR customer_category_id IN (SELECT id FROM selected_categories))
          AND ($3::text IS NULL OR article ILIKE $3 ESCAPE '\\' OR product_name ILIKE $3 ESCAPE '\\')
          AND ($4::text IS NULL OR assignment_source = $4)
          AND ($5::text IS NULL OR assignment_origin = $5)
          AND ($6::text IS NULL OR confidence = $6)
          AND ($7::text IS NULL OR approval_status = $7)
          AND ($8::text IS NULL OR rule_code = $8)
          AND ($9::text IS NULL OR number_family = $9)
          AND ($10::text IS NULL OR technical_epc_group = $10 OR rule_epc_group = $10)
      )
    `;
    const [countResult, rowsResult] = await Promise.all([
      db.query(`${common} SELECT COUNT(*)::integer AS total FROM filtered`, parameters),
      db.query(`${common}
        SELECT * FROM filtered
        ORDER BY assigned_at DESC, product_id, customer_category_id
        LIMIT $11 OFFSET $12
      `, [...parameters, pageSize, (page - 1) * pageSize]),
    ]);
    return {
      rows: rowsResult.rows.map(mapProductRow),
      total: number(countResult.rows[0]?.total),
    };
  },

  async getProductDetails(productId, locale, db = pool) {
    const result = await db.query(`
      WITH ${technicalCategoriesCte}
      SELECT
        product.id AS product_id,
        product.article,
        product.name AS product_name,
        CASE
          WHEN COALESCE(product.article_normalized, product.article, '') LIKE 'A%' THEN 'A'
          WHEN COALESCE(product.article_normalized, product.article, '') LIKE 'N%' THEN 'N'
          WHEN COALESCE(product.article_normalized, product.article, '') LIKE 'B%' THEN 'B'
          ELSE 'OTHER'
        END AS number_family,
        CASE
          WHEN COALESCE(product.article_normalized, product.article, '') ~ '^A[0-9]{6,}$'
          THEN SUBSTRING(COALESCE(product.article_normalized, product.article, '') FROM 5 FOR 2)
          ELSE NULL
        END AS technical_epc_group,
        COALESCE(technical.categories, '[]'::JSONB) AS technical_categories,
        membership.customer_category_id,
        category.slug AS customer_category_slug,
        category_name.name AS customer_category_name,
        parent.id AS customer_parent_id,
        parent.slug AS customer_parent_slug,
        parent_name.name AS customer_parent_name,
        membership.assignment_source,
        membership.assignment_origin,
        membership.rule_code,
        membership.rule_version,
        rule.number_family AS rule_number_family,
        rule.epc_group AS rule_epc_group,
        membership.confidence,
        membership.approval_status,
        membership.is_primary,
        membership.assigned_at
      FROM products product
      JOIN product_customer_categories membership ON membership.product_id = product.id
      JOIN customer_categories category ON category.id = membership.customer_category_id
      LEFT JOIN customer_categories parent ON parent.id = category.parent_id
      LEFT JOIN customer_classification_rules rule
        ON rule.code = membership.rule_code
       AND rule.version = membership.rule_version
      LEFT JOIN technical ON technical.product_id = product.id
      LEFT JOIN LATERAL (
        SELECT translation.name
        FROM customer_category_translations translation
        WHERE translation.category_id = category.id
        ORDER BY CASE translation.language_code
          WHEN $1::text THEN 0 WHEN 'uk' THEN 1 WHEN 'ru' THEN 2 WHEN 'en' THEN 3 ELSE 4
        END
        LIMIT 1
      ) category_name ON TRUE
      LEFT JOIN LATERAL (
        SELECT translation.name
        FROM customer_category_translations translation
        WHERE translation.category_id = parent.id
        ORDER BY CASE translation.language_code
          WHEN $1::text THEN 0 WHEN 'uk' THEN 1 WHEN 'ru' THEN 2 WHEN 'en' THEN 3 ELSE 4
        END
        LIMIT 1
      ) parent_name ON TRUE
      WHERE product.id = $2
      ORDER BY membership.is_primary DESC, membership.customer_category_id
    `, [locale, productId]);
    return result.rows.map(mapProductRow);
  },
};
