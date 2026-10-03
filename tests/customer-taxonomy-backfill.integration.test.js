import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { CustomerTaxonomyRepository } from "../src/repositories/CustomerTaxonomyRepository.js";
import {
  CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
  CustomerTaxonomyBackfillError,
  runCustomerTaxonomyBackfill,
} from "../src/services/CustomerTaxonomyBackfillService.js";

const suffix = `${process.pid}${Date.now()}`.slice(-8);
const ids = {
  auto: null,
  manual: null,
  rejected: null,
  historical: null,
  phase2d: null,
};
let filterCategoryId;
let manualCategoryId;
let filterRule;
let historicalFilterRule;

async function taxonomyEpcFingerprint() {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM categories) AS categories_count,
      (SELECT MD5(COALESCE(STRING_AGG(row_value, '|' ORDER BY row_value), ''))
       FROM (
         SELECT CONCAT_WS(':', id, slug, COALESCE(parent_id::text, ''), is_active::text)
           AS row_value
         FROM categories
       ) category_rows) AS categories_hash,
      (SELECT COUNT(*)::integer FROM product_categories) AS memberships_count,
      (SELECT MD5(COALESCE(STRING_AGG(row_value, '|' ORDER BY row_value), ''))
       FROM (
         SELECT CONCAT_WS(
           ':', product_id, category_id, assignment_source, confidence
         ) AS row_value
         FROM product_categories
       ) membership_rows) AS memberships_hash
  `);
  return result.rows[0];
}

function scopedRepository(productIds) {
  const allowed = new Set(productIds);
  return {
    ...CustomerTaxonomyRepository,
    async listProductsForPreview(db) {
      const products = await CustomerTaxonomyRepository.listProductsForPreview(db);
      return products.filter((product) => allowed.has(product.id));
    },
    async listMemberships(db) {
      const memberships = await CustomerTaxonomyRepository.listMemberships(db);
      return memberships.filter((membership) => allowed.has(membership.productId));
    },
    async getBackfillVerification(db) {
      const memberships = await this.listMemberships(db);
      const rules = await db.query("SELECT code, version FROM customer_classification_rules");
      const ruleKeys = new Set(rules.rows.map((rule) => `${rule.code}:${rule.version}`));
      const primaryCounts = new Map();
      for (const membership of memberships) {
        if (!membership.isPrimary) continue;
        primaryCounts.set(
          membership.productId,
          (primaryCounts.get(membership.productId) || 0) + 1,
        );
      }
      return {
        memberships: memberships.length,
        approvedPrimary: memberships.filter((membership) => (
          membership.isPrimary
          && ["AUTO_APPROVED", "MANUAL_APPROVED"].includes(membership.approvalStatus)
        )).length,
        rule: memberships.filter((membership) => membership.assignmentSource === "RULE").length,
        backfill: memberships.filter((membership) => (
          membership.assignmentOrigin === "BACKFILL"
        )).length,
        high: memberships.filter((membership) => membership.confidence === "HIGH").length,
        autoApproved: memberships.filter((membership) => (
          membership.approvalStatus === "AUTO_APPROVED"
        )).length,
        duplicatePrimary: [...primaryCounts.values()].filter((count) => count > 1).length,
        orphanRule: memberships.filter((membership) => (
          membership.ruleCode
          && !ruleKeys.has(`${membership.ruleCode}:${membership.ruleVersion}`)
        )).length,
        inactiveTarget: 0,
      };
    },
  };
}

async function insertProduct(label, offset) {
  const article = `A00018${String(Number(suffix) + offset).padStart(6, "0").slice(-6)}`;
  const result = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, $2, TRUE)
    RETURNING id
  `, [article, `Фільтр оливи ${label}`]);
  return Number(result.rows[0].id);
}

before(async () => {
  const categoryResult = await pool.query(`
    SELECT id, slug
    FROM customer_categories
    WHERE slug IN ('filters-oil', 'brakes-pads')
  `);
  const categoryBySlug = new Map(
    categoryResult.rows.map((row) => [row.slug, Number(row.id)]),
  );
  filterCategoryId = categoryBySlug.get("filters-oil");
  manualCategoryId = categoryBySlug.get("brakes-pads");
  const ruleResult = await pool.query(`
    SELECT code, version
    FROM customer_classification_rules
    WHERE code = 'FILTER_OIL_A_EPC18_V1'
      AND is_active = TRUE
  `);
  filterRule = ruleResult.rows[0];
  const historicalRuleResult = await pool.query(`
    SELECT code, version
    FROM customer_classification_rules
    WHERE code = 'FILTER_OIL_A_EPC18_V1'
      AND version = 1
      AND detector_version = 2
      AND is_active = FALSE
  `);
  historicalFilterRule = historicalRuleResult.rows[0];
  ids.auto = await insertProduct("backfill", 1);
  ids.manual = await insertProduct("manual", 2);
  ids.rejected = await insertProduct("rejected", 3);
  ids.historical = await insertProduct("historical", 4);
  const phase2d = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, 'Диск колісний легкосплавний', TRUE)
    RETURNING id
  `, [`A1674012000${suffix}X23`]);
  ids.phase2d = Number(phase2d.rows[0].id);
  await pool.query(`
    INSERT INTO product_categories(
      product_id, category_id, assignment_source, confidence
    )
    SELECT $1, id, 'AUTO_RULE', 100
    FROM categories
    WHERE slug = 'mb-group-40'
  `, [ids.phase2d]);

  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, is_primary,
      assignment_source, assignment_origin, confidence,
      approval_status, assigned_at, approved_at, updated_at
    ) VALUES($1, $2, TRUE, 'MANUAL', 'ADMIN', 'HIGH',
             'MANUAL_APPROVED', NOW(), NOW(), NOW())
  `, [ids.manual, manualCategoryId]);
  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, is_primary,
      assignment_source, assignment_origin, rule_code, rule_version,
      confidence, approval_status, assigned_at, approved_at, updated_at
    ) VALUES($1, $2, FALSE, 'RULE', 'ADMIN', $3, $4,
             'HIGH', 'REJECTED', NOW(), NULL, NOW())
  `, [ids.rejected, filterCategoryId, filterRule.code, filterRule.version]);
  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, is_primary,
      assignment_source, assignment_origin, rule_code, rule_version,
      confidence, approval_status, assigned_at, approved_at, updated_at
    ) VALUES($1, $2, TRUE, 'RULE', 'BACKFILL', $3, $4,
             'HIGH', 'AUTO_APPROVED', NOW(), NOW(), NOW())
  `, [
    ids.historical,
    filterCategoryId,
    historicalFilterRule.code,
    historicalFilterRule.version,
  ]);
});

after(async () => {
  const productIds = Object.values(ids).filter(Boolean);
  if (productIds.length) {
    await pool.query(
      "DELETE FROM product_customer_categories WHERE product_id = ANY($1::integer[])",
      [productIds],
    );
    await pool.query("DELETE FROM products WHERE id = ANY($1::integer[])", [productIds]);
  }
  await pool.end();
});

test("controlled PostgreSQL backfill is dry by default, atomic and idempotent", async () => {
  const epcBefore = await taxonomyEpcFingerprint();
  const repository = scopedRepository([ids.auto]);

  const dryRun = await runCustomerTaxonomyBackfill({ dbPool: pool, repository });
  assert.equal(dryRun.mode, "DRY_RUN");
  assert.equal(dryRun.candidateCount, 1);
  assert.equal(dryRun.wouldInsert, 1);
  assert.equal(dryRun.inserted, 0);
  const afterDryRun = await pool.query(
    "SELECT COUNT(*)::integer AS count FROM product_customer_categories WHERE product_id = $1",
    [ids.auto],
  );
  assert.equal(afterDryRun.rows[0].count, 0);

  await assert.rejects(runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 2,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: pool,
    repository,
  }), (error) => {
    assert.ok(error instanceof CustomerTaxonomyBackfillError);
    assert.ok(error.report.errors.includes("EXPECTED_COUNT_MISMATCH:2:1"));
    return true;
  });
  const afterAbortedApply = await pool.query(
    "SELECT COUNT(*)::integer AS count FROM product_customer_categories WHERE product_id = $1",
    [ids.auto],
  );
  assert.equal(afterAbortedApply.rows[0].count, 0);

  const applied = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: pool,
    repository,
  });
  assert.equal(applied.inserted, 1);
  assert.equal(applied.updated, 0);
  assert.equal(applied.unchanged, 0);

  const membership = await pool.query(`
    SELECT assignment_source, assignment_origin, rule_code, rule_version,
           confidence, approval_status, is_primary, assigned_at, approved_at
    FROM product_customer_categories
    WHERE product_id = $1
  `, [ids.auto]);
  assert.equal(membership.rowCount, 1);
  assert.deepEqual({
    assignmentSource: membership.rows[0].assignment_source,
    assignmentOrigin: membership.rows[0].assignment_origin,
    ruleCode: membership.rows[0].rule_code,
    ruleVersion: membership.rows[0].rule_version,
    confidence: membership.rows[0].confidence,
    approvalStatus: membership.rows[0].approval_status,
    isPrimary: membership.rows[0].is_primary,
  }, {
    assignmentSource: "RULE",
    assignmentOrigin: "BACKFILL",
    ruleCode: filterRule.code,
    ruleVersion: filterRule.version,
    confidence: "HIGH",
    approvalStatus: "AUTO_APPROVED",
    isPrimary: true,
  });
  assert.ok(membership.rows[0].assigned_at);
  assert.ok(membership.rows[0].approved_at);

  const repeated = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: pool,
    repository,
  });
  assert.equal(repeated.inserted, 0);
  assert.equal(repeated.updated, 0);
  assert.equal(repeated.unchanged, 1);

  const primary = await pool.query(`
    SELECT COUNT(*)::integer AS count
    FROM product_customer_categories
    WHERE product_id = $1 AND is_primary = TRUE
  `, [ids.auto]);
  assert.equal(primary.rows[0].count, 1);
  assert.deepEqual(await taxonomyEpcFingerprint(), epcBefore);
});

test("controlled backfill preserves MANUAL and REJECTED decisions", async () => {
  const manual = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: pool,
    repository: scopedRepository([ids.manual]),
  });
  assert.equal(manual.candidateCount, 0);
  assert.equal(manual.manualPreserved, 1);

  const rejected = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: pool,
    repository: scopedRepository([ids.rejected]),
  });
  assert.equal(rejected.rejectedPreserved, 1);
  const decision = await pool.query(`
    SELECT approval_status, is_primary
    FROM product_customer_categories
    WHERE product_id = $1 AND customer_category_id = $2
  `, [ids.rejected, filterCategoryId]);
  assert.deepEqual(decision.rows[0], { approval_status: "REJECTED", is_primary: false });
});

test("VERIFY checks the PostgreSQL membership and performs zero writes", async () => {
  const repository = scopedRepository([ids.auto]);
  const before = await pool.query(`
    SELECT assigned_at, approved_at, updated_at
    FROM product_customer_categories
    WHERE product_id = $1
  `, [ids.auto]);
  const report = await runCustomerTaxonomyBackfill({
    mode: "VERIFY",
    expectedCount: 1,
    dbPool: pool,
    repository,
  });
  assert.equal(report.mode, "VERIFY");
  assert.equal(report.errors.length, 0);
  assert.equal(report.verification.duplicatePrimary, 0);
  assert.equal(report.verification.orphanRule, 0);
  assert.equal(report.verification.inactiveTarget, 0);
  const afterResult = await pool.query(`
    SELECT assigned_at, approved_at, updated_at
    FROM product_customer_categories
    WHERE product_id = $1
  `, [ids.auto]);
  assert.deepEqual(afterResult.rows, before.rows);
});

test("controlled backfill preserves an approved membership on inactive historical rule v1", async () => {
  const repository = scopedRepository([ids.historical]);
  const beforeResult = await pool.query(`
    SELECT rule_code, rule_version, assigned_at, approved_at, updated_at
    FROM product_customer_categories
    WHERE product_id = $1
  `, [ids.historical]);

  const dryRun = await runCustomerTaxonomyBackfill({ dbPool: pool, repository });
  assert.equal(dryRun.candidateCount, 1);
  assert.equal(dryRun.wouldInsert, 0);
  assert.equal(dryRun.wouldUpdate, 0);
  assert.equal(dryRun.approvedPrimaryPreserved, 1);

  const applied = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: pool,
    repository,
  });
  assert.equal(applied.inserted, 0);
  assert.equal(applied.updated, 0);
  assert.equal(applied.approvedPrimaryPreserved, 1);

  const afterResult = await pool.query(`
    SELECT rule_code, rule_version, assigned_at, approved_at, updated_at
    FROM product_customer_categories
    WHERE product_id = $1
  `, [ids.historical]);
  assert.deepEqual(afterResult.rows, beforeResult.rows);
  assert.equal(afterResult.rows[0].rule_code, filterRule.code);
  assert.equal(afterResult.rows[0].rule_version, 1);

  const verification = await runCustomerTaxonomyBackfill({
    mode: "VERIFY",
    expectedCount: 1,
    dbPool: pool,
    repository,
  });
  assert.equal(verification.errors.length, 0);
  assert.equal(verification.verification.orphanRule, 0);
});

test("PHASE 2D controlled backfill uses EPC membership for an alphanumeric wheel variant", async () => {
  const repository = scopedRepository([ids.phase2d]);
  const dryRun = await runCustomerTaxonomyBackfill({ dbPool: pool, repository });
  assert.equal(dryRun.candidateCount, 1);
  assert.equal(dryRun.wouldInsert, 1);
  assert.deepEqual(dryRun.breakdown.sections, {
    "filters-maintenance": 0,
    brakes: 0,
    accessories: 0,
    wheels: 1,
  });

  const applied = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: pool,
    repository,
  });
  assert.equal(applied.inserted, 1);

  const result = await pool.query(`
    SELECT category.slug, parent.slug AS parent_slug,
           membership.assignment_source, membership.assignment_origin,
           membership.approval_status, membership.is_primary,
           membership.rule_code
    FROM product_customer_categories membership
    JOIN customer_categories category
      ON category.id = membership.customer_category_id
    JOIN customer_categories parent ON parent.id = category.parent_id
    WHERE membership.product_id = $1
  `, [ids.phase2d]);
  assert.deepEqual(result.rows, [{
    slug: "wheels-rims",
    parent_slug: "wheels",
    assignment_source: "RULE",
    assignment_origin: "BACKFILL",
    approval_status: "AUTO_APPROVED",
    is_primary: true,
    rule_code: "WHEEL_RIM_A_EPC40_V1",
  }]);
});
