import { pool } from "../config/db.js";

function categoryCycleError() {
  const error = new Error("Нельзя переместить категорию внутрь её собственного поддерева");
  error.code = "CUSTOMER_CATEGORY_CYCLE";
  return error;
}

function mapRule(row) {
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

function mapMembership(row) {
  return {
    productId: Number(row.product_id),
    customerCategoryId: Number(row.customer_category_id),
    categorySlug: row.category_slug || null,
    parentSlug: row.parent_slug || null,
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
  };
}

export const CustomerTaxonomyRepository = {
  async listActiveRules(db = pool) {
    const result = await db.query(`
      SELECT
        rule.*,
        category.slug AS target_category_slug,
        category.parent_id AS target_parent_id,
        category.status AS target_status,
        category.is_active AS target_is_active,
        parent.slug AS target_parent_slug
      FROM customer_classification_rules rule
      JOIN customer_categories category
        ON category.id = rule.target_category_id
      LEFT JOIN customer_categories parent
        ON parent.id = category.parent_id
      WHERE rule.is_active = TRUE
      ORDER BY rule.priority, rule.code, rule.version DESC, rule.id
    `);
    return result.rows.map(mapRule);
  },

  async listProductsForPreview(db = pool) {
    const result = await db.query(`
      SELECT
        product.id,
        product.article,
        product.article_normalized,
        product.name,
        CASE
          WHEN COALESCE(product.article_normalized, product.article, '')
            ~ '^A[0-9]{6,}$'
          THEN SUBSTRING(
            COALESCE(product.article_normalized, product.article, '')
            FROM 5 FOR 2
          )
          ELSE NULL
        END AS technical_epc_group,
        COALESCE(
          JSONB_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'id', category.id,
              'slug', category.slug,
              'name', category.name,
              'assignmentSource', assignment.assignment_source
            )
          ) FILTER (WHERE category.id IS NOT NULL),
          '[]'::JSONB
        ) AS technical_categories
      FROM products product
      LEFT JOIN product_categories assignment
        ON assignment.product_id = product.id
      LEFT JOIN categories category
        ON category.id = assignment.category_id
      WHERE product.is_active IS DISTINCT FROM FALSE
      GROUP BY product.id
      ORDER BY product.id
    `);
    return result.rows.map((row) => ({
      id: Number(row.id),
      article: row.article,
      articleNormalized: row.article_normalized,
      name: row.name,
      technicalEpcGroups: row.technical_epc_group
        ? [row.technical_epc_group]
        : [],
      technicalCategories: row.technical_categories || [],
    }));
  },

  async listMemberships(db = pool) {
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
      ORDER BY membership.product_id, membership.is_primary DESC,
               membership.customer_category_id
    `);
    return result.rows.map(mapMembership);
  },

  async listMembershipsForProduct(productId, db = pool, { lock = false } = {}) {
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
      WHERE membership.product_id = $1
      ORDER BY membership.is_primary DESC, membership.customer_category_id
      ${lock ? "FOR UPDATE OF membership" : ""}
    `, [productId]);
    return result.rows.map(mapMembership);
  },

  async upsertMembership({
    productId,
    customerCategoryId,
    isPrimary = false,
    assignmentSource,
    assignmentOrigin,
    ruleCode = null,
    ruleVersion = null,
    confidence,
    approvalStatus,
    approvedBy = null,
  }, db = pool) {
    const approved = ["AUTO_APPROVED", "MANUAL_APPROVED"].includes(approvalStatus);
    const result = await db.query(`
      INSERT INTO product_customer_categories(
        product_id,
        customer_category_id,
        is_primary,
        assignment_source,
        assignment_origin,
        rule_code,
        rule_version,
        confidence,
        approval_status,
        assigned_at,
        approved_at,
        approved_by,
        updated_at
      )
      VALUES(
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        NOW(),
        CASE WHEN $10::boolean THEN NOW() ELSE NULL END,
        $11,
        NOW()
      )
      ON CONFLICT(product_id, customer_category_id)
      DO UPDATE SET
        is_primary = EXCLUDED.is_primary,
        assignment_source = EXCLUDED.assignment_source,
        assignment_origin = EXCLUDED.assignment_origin,
        rule_code = EXCLUDED.rule_code,
        rule_version = EXCLUDED.rule_version,
        confidence = EXCLUDED.confidence,
        approval_status = EXCLUDED.approval_status,
        approved_at = EXCLUDED.approved_at,
        approved_by = EXCLUDED.approved_by,
        updated_at = NOW()
      RETURNING *
    `, [
      productId,
      customerCategoryId,
      isPrimary,
      assignmentSource,
      assignmentOrigin,
      ruleCode,
      ruleVersion,
      confidence,
      approvalStatus,
      approved,
      approvedBy,
    ]);
    return mapMembership(result.rows[0]);
  },

  async demoteAutomaticPrimary(productId, db = pool) {
    await db.query(`
      UPDATE product_customer_categories
      SET is_primary = FALSE, updated_at = NOW()
      WHERE product_id = $1
        AND is_primary = TRUE
        AND assignment_source <> 'MANUAL'
    `, [productId]);
  },

  async demoteAllPrimary(productId, db = pool) {
    await db.query(`
      UPDATE product_customer_categories
      SET is_primary = FALSE, updated_at = NOW()
      WHERE product_id = $1
        AND is_primary = TRUE
    `, [productId]);
  },

  async setCategoryParent({ categoryId, parentId = null }, dbPool = pool) {
    const client = typeof dbPool.connect === "function"
      ? await dbPool.connect()
      : dbPool;
    const release = client !== dbPool && typeof client.release === "function";
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query("LOCK TABLE customer_categories IN SHARE ROW EXCLUSIVE MODE");

      const categoryResult = await client.query(
        "SELECT id FROM customer_categories WHERE id = $1",
        [categoryId],
      );
      if (!categoryResult.rowCount) throw new Error("Customer category not found");
      if (parentId !== null && Number(categoryId) === Number(parentId)) {
        throw categoryCycleError();
      }

      if (parentId !== null) {
        const parentResult = await client.query(
          "SELECT id FROM customer_categories WHERE id = $1",
          [parentId],
        );
        if (!parentResult.rowCount) throw new Error("Customer parent category not found");
        const cycleResult = await client.query(`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id
            FROM customer_categories
            WHERE id = $1
            UNION ALL
            SELECT parent.id, parent.parent_id
            FROM customer_categories parent
            JOIN ancestors child ON parent.id = child.parent_id
          )
          SELECT 1
          FROM ancestors
          WHERE id = $2
          LIMIT 1
        `, [parentId, categoryId]);
        if (cycleResult.rowCount) throw categoryCycleError();
      }

      const updated = await client.query(`
        UPDATE customer_categories
        SET parent_id = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [categoryId, parentId]);
      await client.query("COMMIT");
      transactionOpen = false;
      return updated.rows[0];
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (release) client.release();
    }
  },
};
