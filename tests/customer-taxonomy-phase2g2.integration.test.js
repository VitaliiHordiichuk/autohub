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
  "../migrations/099_add_customer_taxonomy_phase2g2_electrical_categories.sql",
  import.meta.url,
);
const ruleMigrationUrl = new URL(
  "../migrations/100_seed_customer_taxonomy_phase2g2_electrical_rules.sql",
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

test("migrations 099/100 Electrical leaves and v8/v9 rules remain historical under v10", async () => {
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
    WHERE parent.slug = 'electrical-electronics-lighting'
  `);
  assert.deepEqual(categories.rows[0], {
    leaves: 19,
    hidden_active: 19,
    translations: 57,
  });

  const rules = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE detector_version = 7 AND is_active = FALSE)::integer
        AS historical_v7,
      COUNT(*) FILTER (WHERE detector_version = 8 AND is_active = FALSE
        AND EXISTS (
          SELECT 1 FROM customer_classification_rules historical
          WHERE historical.code = customer_classification_rules.code
            AND historical.detector_version = 7
            AND historical.version + 1 = customer_classification_rules.version
        ))::integer AS v8_successors,
      COUNT(*) FILTER (WHERE detector_version = 8 AND is_active = FALSE
        AND version = 1 AND code LIKE '%PHASE2G2_V1')::integer AS phase2g2,
      COUNT(*) FILTER (WHERE detector_version = 9 AND is_active = FALSE)::integer AS historical_v9,
      COUNT(*) FILTER (WHERE detector_version = 10 AND is_active = TRUE)::integer AS active_v10,
      COUNT(*)::integer AS total,
      (SELECT COUNT(*)::integer FROM (
        SELECT code FROM customer_classification_rules WHERE is_active = TRUE
        GROUP BY code HAVING COUNT(*) > 1
      ) duplicate) AS duplicate_active
    FROM customer_classification_rules
  `);
  assert.deepEqual(rules.rows[0], {
    historical_v7: 313,
    v8_successors: 313,
    phase2g2: 48,
    historical_v9: 373,
    active_v10: 374,
    total: 2280,
    duplicate_active: 0,
  });

  const successorDrift = await pool.query(`
    SELECT historical.code
    FROM customer_classification_rules historical
    JOIN customer_classification_rules successor
      ON successor.code = historical.code
     AND successor.version = historical.version + 1
     AND successor.detector_version = 8
     AND successor.is_active = FALSE
    WHERE historical.detector_version = 7
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

test("historical migrations 099/100 remain membership-free and preserve EPC taxonomy", async () => {
  const categorySql = await readFile(categoryMigrationUrl, "utf8");
  const ruleSql = await readFile(ruleMigrationUrl, "utf8");
  for (const sql of [categorySql, ruleSql]) {
    assert.doesNotMatch(
      sql,
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:product_customer_categories|categories|product_categories|products)\b/iu,
    );
  }
  assert.doesNotMatch(categorySql, /\bproduct_customer_categories\b/iu);
  assert.doesNotMatch(ruleSql, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+product_customer_categories\b/iu);
});

test("an inactive v7 rule remains valid provenance for its historical membership", async () => {
  const fixture = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, 'Historical detector v7 membership', TRUE)
    RETURNING id
  `, [`HISTORYV8${process.pid}${Date.now()}`]);
  const id = Number(fixture.rows[0].id);
  createdProductIds.push(id);
  touchedProductIds.add(id);
  const historical = await pool.query(`
    SELECT code, version, target_category_id
    FROM customer_classification_rules
    WHERE detector_version = 7 AND is_active = FALSE
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
  assert.equal(afterResult.rows[0].detector_version, 7);
  assert.equal(afterResult.rows[0].is_active, false);
  const verification = await CustomerTaxonomyRepository.getBackfillVerification(pool);
  assert.equal(verification.orphanRule, 0);
});

test("controlled PHASE 2G.2 HIGH and SAFE backfills apply once and remain idempotent", async () => {
  const highId = await productId("A0001512013");
  const safeId = await productId("A0005402605");
  await pool.query(
    "DELETE FROM product_customer_categories WHERE product_id = ANY($1::integer[])",
    [[highId, safeId]],
  );

  const highRepository = scopedRepository([highId]);
  const highDry = await runCustomerTaxonomyBackfill({ repository: highRepository });
  assert.equal(highDry.candidateCount, 1);
  assert.equal(highDry.breakdown.leaves["electrical-starters"], 1);
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

  const safeRepository = scopedRepository([safeId]);
  const safeDry = await runCustomerTaxonomyBackfill({
    includeSafeTopLevel: true,
    repository: safeRepository,
  });
  assert.equal(safeDry.candidateCount, 1);
  assert.equal(safeDry.safeTopLevelCandidates[0].categorySlug,
    "electrical-electronics-lighting");
  assert.equal(safeDry.safeTopLevelCandidates[0].reviewSource, "PHASE_2G2_AUDIT");
  const safeApply = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    includeSafeTopLevel: true,
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION,
    repository: safeRepository,
  });
  assert.equal(safeApply.insertedSafeTopLevel, 1);
  const safeRepeat = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    includeSafeTopLevel: true,
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION,
    repository: safeRepository,
  });
  assert.equal(safeRepeat.inserted, 0);
  assert.equal(safeRepeat.unchanged, 1);

  const memberships = await pool.query(`
    SELECT product_id, assignment_source, assignment_origin, confidence,
           approval_status, rule_code, rule_version, is_primary
    FROM product_customer_categories
    WHERE product_id = ANY($1::integer[])
    ORDER BY product_id
  `, [[highId, safeId]]);
  assert.equal(memberships.rowCount, 2);
  const high = memberships.rows.find((row) => Number(row.product_id) === highId);
  const safe = memberships.rows.find((row) => Number(row.product_id) === safeId);
  assert.equal(high.assignment_source, "RULE");
  assert.equal(high.assignment_origin, "BACKFILL");
  assert.equal(high.confidence, "HIGH");
  assert.ok(high.rule_code);
  assert.equal(safe.assignment_source, "EPC_FALLBACK");
  assert.equal(safe.assignment_origin, "BACKFILL");
  assert.equal(safe.confidence, "MEDIUM");
  assert.equal(safe.rule_code, null);

  const verification = await CustomerTaxonomyRepository.getBackfillVerification(pool);
  assert.equal(verification.duplicatePrimary, 0);
  assert.equal(verification.orphanRule, 0);
  assert.equal(verification.inactiveTarget, 0);
});
