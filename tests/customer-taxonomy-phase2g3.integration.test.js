import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { pool } from "../src/config/db.js";
import { CustomerTaxonomyRepository } from "../src/repositories/CustomerTaxonomyRepository.js";
import {
  CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
  CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION,
  runCustomerTaxonomyBackfill,
} from "../src/services/CustomerTaxonomyBackfillService.js";

const categoryMigrationUrl = new URL(
  "../migrations/101_add_customer_taxonomy_phase2g3_fasteners_categories.sql",
  import.meta.url,
);
const ruleMigrationUrl = new URL(
  "../migrations/102_seed_customer_taxonomy_phase2g3_fasteners_rules.sql",
  import.meta.url,
);
const touchedProductIds = new Set();
const createdProductIds = [];

function scopedRepository(productIds) {
  const allowed = new Set(productIds);
  return {
    ...CustomerTaxonomyRepository,
    async listProductsForPreview(db) {
      return (await CustomerTaxonomyRepository.listProductsForPreview(db))
        .filter((product) => allowed.has(product.id));
    },
    async listMemberships(db) {
      return (await CustomerTaxonomyRepository.listMemberships(db))
        .filter((membership) => allowed.has(membership.productId));
    },
  };
}

async function productId(article) {
  const result = await pool.query(
    "SELECT id FROM products WHERE article_normalized = $1 ORDER BY id LIMIT 1",
    [article],
  );
  assert.equal(result.rowCount, 1, `missing isolated fixture ${article}`);
  const id = Number(result.rows[0].id);
  touchedProductIds.add(id);
  return id;
}

after(async () => {
  if (touchedProductIds.size) {
    await pool.query(
      "DELETE FROM product_customer_categories WHERE product_id = ANY($1::integer[])",
      [[...touchedProductIds]],
    );
  }
  if (createdProductIds.length) {
    await pool.query("DELETE FROM products WHERE id = ANY($1::integer[])", [createdProductIds]);
  }
  await pool.end();
});

test("migrations 101/102 create 12 hidden Fasteners leaves and version rules to v9", async () => {
  const categories = await pool.query(`
    SELECT COUNT(DISTINCT child.id)::integer AS leaves,
           COUNT(DISTINCT child.id) FILTER (WHERE child.status = 'ACTIVE'
             AND child.is_active = TRUE
             AND child.is_navigation_visible = FALSE)::integer AS hidden_active,
           COUNT(translation.language_code)::integer AS translations
    FROM customer_categories child
    JOIN customer_categories parent ON parent.id = child.parent_id
    LEFT JOIN customer_category_translations translation
      ON translation.category_id = child.id
     AND translation.language_code IN ('uk','ru','en')
    WHERE parent.slug = 'fasteners-seals-standard-parts'
  `);
  assert.deepEqual(categories.rows[0], {
    leaves: 12,
    hidden_active: 12,
    translations: 36,
  });

  const rules = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE detector_version = 8 AND is_active = FALSE)::integer
        AS historical_v8,
      COUNT(*) FILTER (WHERE detector_version = 9 AND is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM customer_classification_rules historical
          WHERE historical.code = customer_classification_rules.code
            AND historical.detector_version = 8
            AND historical.version + 1 = customer_classification_rules.version
        ))::integer AS v9_successors,
      COUNT(*) FILTER (WHERE detector_version = 9 AND is_active = TRUE
        AND version = 1 AND code LIKE '%PHASE2G3_V1')::integer AS phase2g3,
      COUNT(*) FILTER (WHERE detector_version = 9 AND is_active = TRUE)::integer AS active_v9,
      COUNT(*)::integer AS total,
      (SELECT COUNT(*)::integer FROM (
        SELECT code FROM customer_classification_rules WHERE is_active = TRUE
        GROUP BY code HAVING COUNT(*) > 1
      ) duplicate) AS duplicate_active
    FROM customer_classification_rules
  `);
  assert.deepEqual(rules.rows[0], {
    historical_v8: 361,
    v9_successors: 361,
    phase2g3: 12,
    active_v9: 373,
    total: 1906,
    duplicate_active: 0,
  });

  const successorDrift = await pool.query(`
    SELECT historical.code
    FROM customer_classification_rules historical
    JOIN customer_classification_rules successor
      ON successor.code = historical.code
     AND successor.version = historical.version + 1
     AND successor.detector_version = 9
     AND successor.is_active = TRUE
    WHERE historical.detector_version = 8
      AND (successor.source_kind IS DISTINCT FROM historical.source_kind
        OR successor.assignment_role IS DISTINCT FROM historical.assignment_role
        OR successor.number_family IS DISTINCT FROM historical.number_family
        OR successor.epc_group IS DISTINCT FROM historical.epc_group
        OR successor.match_type IS DISTINCT FROM historical.match_type
        OR successor.match_value IS DISTINCT FROM historical.match_value
        OR successor.exclude_values IS DISTINCT FROM historical.exclude_values
        OR successor.target_category_id IS DISTINCT FROM historical.target_category_id
        OR successor.priority IS DISTINCT FROM historical.priority
        OR successor.confidence IS DISTINCT FROM historical.confidence
        OR successor.auto_approval_allowed IS DISTINCT FROM historical.auto_approval_allowed)
  `);
  assert.equal(successorDrift.rowCount, 0);
});

test("migrations 101/102 are repeat-safe and never write memberships or EPC taxonomy", async () => {
  const categorySql = await readFile(categoryMigrationUrl, "utf8");
  const ruleSql = await readFile(ruleMigrationUrl, "utf8");
  for (const sql of [categorySql, ruleSql]) {
    assert.doesNotMatch(
      sql,
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:product_customer_categories|categories|product_categories|products)\b/iu,
    );
  }
  const before = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM customer_classification_rules) AS rules,
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS memberships,
      (SELECT COUNT(*)::integer FROM categories) AS epc_categories,
      (SELECT COUNT(*)::integer FROM product_categories) AS epc_memberships
  `);
  await pool.query(categorySql);
  await pool.query(ruleSql);
  const afterResult = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM customer_classification_rules) AS rules,
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS memberships,
      (SELECT COUNT(*)::integer FROM categories) AS epc_categories,
      (SELECT COUNT(*)::integer FROM product_categories) AS epc_memberships
  `);
  assert.deepEqual(afterResult.rows[0], before.rows[0]);
});

test("an inactive v8 rule remains valid provenance for its historical membership", async () => {
  const fixture = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, 'Historical detector v8 membership', TRUE)
    RETURNING id
  `, [`HISTORYV9${process.pid}${Date.now()}`]);
  const id = Number(fixture.rows[0].id);
  createdProductIds.push(id);
  touchedProductIds.add(id);
  const historical = await pool.query(`
    SELECT code, version, target_category_id
    FROM customer_classification_rules
    WHERE detector_version = 8 AND is_active = FALSE
    ORDER BY id LIMIT 1
  `);
  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, is_primary,
      assignment_source, assignment_origin, rule_code, rule_version,
      confidence, approval_status, approved_at
    ) VALUES($1, $2, TRUE, 'RULE', 'BACKFILL', $3, $4,
             'HIGH', 'AUTO_APPROVED', NOW())
  `, [id, historical.rows[0].target_category_id, historical.rows[0].code,
    historical.rows[0].version]);
  const before = await pool.query(`
    SELECT rule_code, rule_version, updated_at
    FROM product_customer_categories WHERE product_id = $1
  `, [id]);
  await pool.query(await readFile(ruleMigrationUrl, "utf8"));
  const afterResult = await pool.query(`
    SELECT membership.rule_code, membership.rule_version, membership.updated_at,
           rule.detector_version, rule.is_active
    FROM product_customer_categories membership
    JOIN customer_classification_rules rule
      ON rule.code = membership.rule_code AND rule.version = membership.rule_version
    WHERE membership.product_id = $1
  `, [id]);
  assert.equal(afterResult.rowCount, 1);
  assert.equal(afterResult.rows[0].rule_code, before.rows[0].rule_code);
  assert.equal(afterResult.rows[0].rule_version, before.rows[0].rule_version);
  assert.deepEqual(afterResult.rows[0].updated_at, before.rows[0].updated_at);
  assert.equal(afterResult.rows[0].detector_version, 8);
  assert.equal(afterResult.rows[0].is_active, false);
  const verification = await CustomerTaxonomyRepository.getBackfillVerification(pool);
  assert.equal(verification.orphanRule, 0);
});

test("PHASE 2G.3 REAL_REVIEW overrides an older SAFE fallback", async () => {
  const reviewId = await productId("A0004901241");
  await pool.query(
    "DELETE FROM product_customer_categories WHERE product_id = $1",
    [reviewId],
  );
  const report = await runCustomerTaxonomyBackfill({
    includeSafeTopLevel: true,
    repository: scopedRepository([reviewId]),
  });
  assert.equal(report.candidateCount, 0);
  assert.equal(report.safeTopLevelCandidates.length, 0);
  assert.equal(report.realReview.some((item) => item.article === "A0004901241"), true);
});

test("controlled PHASE 2G.3 HIGH and SAFE backfills apply once and remain idempotent", async () => {
  const highId = await productId("A0003330771");
  const safeId = await productId("A0009811178");
  const supplementaryId = await productId("A2033200056");
  await pool.query(
    "DELETE FROM product_customer_categories WHERE product_id = ANY($1::integer[])",
    [[highId, safeId, supplementaryId]],
  );

  const highRepository = scopedRepository([highId]);
  const highDry = await runCustomerTaxonomyBackfill({ repository: highRepository });
  assert.equal(highDry.candidateCount, 1);
  assert.equal(highDry.breakdown.leaves["fasteners-bolts"], 1);
  const highApply = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    repository: highRepository,
  });
  assert.equal(highApply.insertedHighRule, 1);
  const highRepeat = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    repository: highRepository,
  });
  assert.equal(highRepeat.inserted, 0);
  assert.equal(highRepeat.unchanged, 1);

  const safeRepository = scopedRepository([safeId, supplementaryId]);
  const safeDry = await runCustomerTaxonomyBackfill({
    includeSafeTopLevel: true,
    repository: safeRepository,
  });
  assert.equal(safeDry.candidateCount, 2);
  assert.deepEqual(safeDry.safeTopLevelCandidates.map((item) => item.article).sort(), [
    "A0009811178",
    "A2033200056",
  ]);
  assert.ok(safeDry.safeTopLevelCandidates.every((item) => (
    item.categorySlug === "fasteners-seals-standard-parts"
    && item.reviewSource === "PHASE_2G3_AUDIT"
  )));
  const safeApply = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    includeSafeTopLevel: true,
    expectedCount: 2,
    confirmation: CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION,
    repository: safeRepository,
  });
  assert.equal(safeApply.insertedSafeTopLevel, 2);
  const safeRepeat = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    includeSafeTopLevel: true,
    expectedCount: 2,
    confirmation: CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION,
    repository: safeRepository,
  });
  assert.equal(safeRepeat.inserted, 0);
  assert.equal(safeRepeat.unchanged, 2);

  const memberships = await pool.query(`
    SELECT product_id, assignment_source, assignment_origin, confidence,
           approval_status, rule_code, rule_version, is_primary
    FROM product_customer_categories
    WHERE product_id = ANY($1::integer[])
    ORDER BY product_id
  `, [[highId, safeId, supplementaryId]]);
  assert.equal(memberships.rowCount, 3);
  const high = memberships.rows.find((row) => Number(row.product_id) === highId);
  const safe = memberships.rows.filter((row) => Number(row.product_id) !== highId);
  assert.equal(high.assignment_source, "RULE");
  assert.equal(high.assignment_origin, "BACKFILL");
  assert.equal(high.confidence, "HIGH");
  assert.ok(high.rule_code);
  assert.ok(safe.every((row) => (
    row.assignment_source === "EPC_FALLBACK"
    && row.assignment_origin === "BACKFILL"
    && row.confidence === "MEDIUM"
    && row.rule_code === null
  )));

  const verification = await CustomerTaxonomyRepository.getBackfillVerification(pool);
  assert.equal(verification.duplicatePrimary, 0);
  assert.equal(verification.orphanRule, 0);
  assert.equal(verification.inactiveTarget, 0);
});
