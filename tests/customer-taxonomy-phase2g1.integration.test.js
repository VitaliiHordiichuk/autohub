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
  "../migrations/097_add_customer_taxonomy_phase2g1_categories.sql",
  import.meta.url,
);
const ruleMigrationUrl = new URL(
  "../migrations/098_seed_customer_taxonomy_phase2g1_rules.sql",
  import.meta.url,
);
const createdProductIds = [];
const touchedMembershipProductIds = new Set();

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

async function reviewedProduct(article, name) {
  const existing = await pool.query(
    "SELECT id FROM products WHERE article_normalized = $1 ORDER BY id LIMIT 1",
    [article],
  );
  if (existing.rowCount) return Number(existing.rows[0].id);
  const result = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, $2, TRUE)
    RETURNING id
  `, [article, name]);
  const id = Number(result.rows[0].id);
  createdProductIds.push(id);
  return id;
}

after(async () => {
  if (touchedMembershipProductIds.size) {
    await pool.query(
      "DELETE FROM product_customer_categories WHERE product_id = ANY($1::integer[])",
      [[...touchedMembershipProductIds]],
    );
  }
  if (createdProductIds.length) {
    await pool.query("DELETE FROM products WHERE id = ANY($1::integer[])", [createdProductIds]);
  }
  await pool.end();
});

test("PHASE 2G.1 leaves remain hidden and v7 rules remain historical under v9", async () => {
  const categories = await pool.query(`
    SELECT parent.slug AS parent_slug, COUNT(*)::integer AS leaf_count,
           COUNT(*) FILTER (WHERE child.status = 'ACTIVE'
             AND child.is_active = TRUE
             AND child.is_navigation_visible = FALSE)::integer AS hidden_active
    FROM customer_categories child
    JOIN customer_categories parent ON parent.id = child.parent_id
    WHERE child.slug = ANY($1::text[])
    GROUP BY parent.slug
    ORDER BY parent.slug
  `, [[
    "body-bumpers", "body-mouldings-trims", "body-grilles", "body-locks-latches",
    "body-door-handles", "body-fenders", "body-hoods", "body-bumper-mounts",
    "body-mirror-parts", "body-side-windows", "body-emblems",
    "body-tailgates-trunk-lids", "body-wheel-arch-liners", "body-exterior-mirrors",
    "body-door-hinges", "body-roof-parts", "body-exterior-panels",
    "body-underbody-shields", "interior-seats", "safety-airbags",
    "interior-trim-panels", "interior-pedals", "interior-seat-mechanisms",
    "safety-restraint-components",
  ]]);
  assert.deepEqual(categories.rows, [
    { parent_slug: "body-glass", leaf_count: 18, hidden_active: 18 },
    { parent_slug: "interior-safety", leaf_count: 6, hidden_active: 6 },
  ]);

  const translations = await pool.query(`
    SELECT COUNT(*)::integer AS count
    FROM customer_category_translations translation
    JOIN customer_categories category ON category.id = translation.category_id
    WHERE category.parent_id IN (
      SELECT id FROM customer_categories WHERE slug IN ('body-glass','interior-safety')
    )
      AND category.slug IN (
        SELECT target.slug FROM customer_categories target
        WHERE target.created_at IS NOT NULL
      )
      AND category.slug = ANY($1::text[])
      AND translation.language_code IN ('uk','ru','en')
  `, [[
    "body-bumpers", "body-mouldings-trims", "body-grilles", "body-locks-latches",
    "body-door-handles", "body-fenders", "body-hoods", "body-bumper-mounts",
    "body-mirror-parts", "body-side-windows", "body-emblems",
    "body-tailgates-trunk-lids", "body-wheel-arch-liners", "body-exterior-mirrors",
    "body-door-hinges", "body-roof-parts", "body-exterior-panels",
    "body-underbody-shields", "interior-seats", "safety-airbags",
    "interior-trim-panels", "interior-pedals", "interior-seat-mechanisms",
    "safety-restraint-components",
  ]]);
  assert.equal(translations.rows[0].count, 72);

  const rules = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE detector_version = 6 AND is_active = FALSE)::integer AS historical_v6,
      COUNT(*) FILTER (WHERE detector_version = 7 AND is_active = FALSE)::integer AS historical_v7,
      COUNT(*) FILTER (WHERE detector_version = 7 AND is_active = FALSE
        AND code LIKE '%PHASE2G1%')::integer AS historical_phase2g1,
      COUNT(*) FILTER (WHERE detector_version = 8 AND is_active = FALSE)::integer AS historical_v8,
      COUNT(*) FILTER (WHERE detector_version = 9 AND is_active = TRUE)::integer AS active_v9,
      (SELECT COUNT(*)::integer FROM (
        SELECT code FROM customer_classification_rules WHERE is_active = TRUE
        GROUP BY code HAVING COUNT(*) > 1
      ) duplicates) AS duplicate_active
    FROM customer_classification_rules
  `);
  assert.deepEqual(rules.rows[0], {
    historical_v6: 258,
    historical_v7: 313,
    historical_phase2g1: 55,
    historical_v8: 361,
    active_v9: 373,
    duplicate_active: 0,
  });
});

test("historical migrations 097/098 remain membership-free after the v9 generation", async () => {
  const before = await pool.query(
    "SELECT COUNT(*)::integer AS count FROM product_customer_categories",
  );
  const categorySql = await readFile(categoryMigrationUrl, "utf8");
  const ruleSql = await readFile(ruleMigrationUrl, "utf8");
  assert.doesNotMatch(categorySql, /\bproduct_customer_categories\b/iu);
  assert.doesNotMatch(ruleSql, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+product_customer_categories\b/iu);
  const afterResult = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS memberships,
      (SELECT COUNT(*)::integer FROM customer_classification_rules
       WHERE detector_version = 7 AND is_active = FALSE) AS historical_v7,
      (SELECT COUNT(*)::integer FROM customer_classification_rules
       WHERE detector_version = 8 AND is_active = FALSE) AS historical_v8,
      (SELECT COUNT(*)::integer FROM customer_classification_rules
       WHERE detector_version = 9 AND is_active = TRUE) AS active_v9,
      (SELECT COUNT(*)::integer FROM (
        SELECT code FROM customer_classification_rules WHERE is_active = TRUE
        GROUP BY code HAVING COUNT(*) > 1
       ) duplicate) AS duplicate_active
  `);
  assert.equal(afterResult.rows[0].memberships, before.rows[0].count);
  assert.equal(afterResult.rows[0].historical_v7, 313);
  assert.equal(afterResult.rows[0].historical_v8, 361);
  assert.equal(afterResult.rows[0].active_v9, 373);
  assert.equal(afterResult.rows[0].duplicate_active, 0);
});

test("historical v6 membership remains valid after v7 migration", async () => {
  const productId = await reviewedProduct(`A99988${Date.now().toString().slice(-6)}`, "Historical v6 rule");
  touchedMembershipProductIds.add(productId);
  const rule = await pool.query(`
    SELECT rule.code, rule.version, rule.target_category_id
    FROM customer_classification_rules rule
    WHERE rule.detector_version = 6 AND rule.is_active = FALSE
    ORDER BY rule.id LIMIT 1
  `);
  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, is_primary,
      assignment_source, assignment_origin, rule_code, rule_version,
      confidence, approval_status, approved_at
    ) VALUES($1, $2, TRUE, 'RULE', 'BACKFILL', $3, $4,
             'HIGH', 'AUTO_APPROVED', NOW())
  `, [productId, rule.rows[0].target_category_id, rule.rows[0].code, rule.rows[0].version]);
  const verification = await CustomerTaxonomyRepository.getBackfillVerification(pool);
  assert.equal(verification.orphanRule, 0);
  const membership = await pool.query(`
    SELECT membership.rule_version, rule.detector_version, rule.is_active
    FROM product_customer_categories membership
    JOIN customer_classification_rules rule
      ON rule.code = membership.rule_code AND rule.version = membership.rule_version
    WHERE membership.product_id = $1
  `, [productId]);
  assert.equal(membership.rows[0].detector_version, 6);
  assert.equal(membership.rows[0].is_active, false);
});

test("controlled HIGH and SAFE PHASE 2G.1 backfills are dry, atomic and idempotent", async () => {
  const highId = await reviewedProduct("A00088501819999", "Накладка бампера");
  const safeId = await reviewedProduct("A1648850223", "Накладка");
  touchedMembershipProductIds.add(highId);
  touchedMembershipProductIds.add(safeId);
  await pool.query(
    "DELETE FROM product_customer_categories WHERE product_id = ANY($1::integer[])",
    [[highId, safeId]],
  );

  const highRepository = scopedRepository([highId]);
  const highDry = await runCustomerTaxonomyBackfill({ repository: highRepository });
  assert.equal(highDry.mode, "DRY_RUN");
  assert.equal(highDry.candidateCount, 1);
  assert.equal(highDry.inserted, 0);
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
  assert.equal(safeDry.inserted, 0);
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
