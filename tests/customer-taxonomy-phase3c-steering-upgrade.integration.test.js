import assert from "node:assert/strict";
import test from "node:test";

import { pool } from "../src/config/db.js";
import {
  CustomerTaxonomyPhase3CSteeringUpgradeRepository,
} from "../src/repositories/CustomerTaxonomyPhase3CSteeringUpgradeRepository.js";
import {
  CustomerTaxonomyPhase3CSteeringUpgradeError,
  PHASE3C_STEERING_ARTICLES,
  PHASE3C_STEERING_CONFIRMATION,
  PHASE3C_STEERING_RULE,
  parsePhase3CSteeringUpgradeArguments,
  runPhase3CSteeringUpgrade,
} from "../src/services/CustomerTaxonomyPhase3CSteeringUpgradeService.js";

const historicalExhaustArticles = [
  "A0004901241",
  "A0004901341",
  "A0004901441",
  "A0004901541",
  "A0004901641",
  "A0004902141",
  "A2024900841",
  "A2034900441",
  "A2034900641",
];

async function categoryId(slug) {
  const result = await pool.query(
    "SELECT id FROM customer_categories WHERE slug = $1",
    [slug],
  );
  assert.equal(result.rowCount, 1, `missing category ${slug}`);
  return Number(result.rows[0].id);
}

async function targetProducts() {
  const result = await pool.query(`
    SELECT id, article, article_normalized
    FROM products
    WHERE article_normalized = ANY($1::text[])
    ORDER BY article_normalized
  `, [PHASE3C_STEERING_ARTICLES]);
  assert.equal(result.rowCount, 2, "isolated PostgreSQL fixture must contain both targets");
  return result.rows.map((row) => ({
    id: Number(row.id),
    article: row.article,
    articleNormalized: row.article_normalized,
  }));
}

async function productIdsForArticles(articles) {
  const result = await pool.query(`
    SELECT id
    FROM products
    WHERE article_normalized = ANY($1::text[])
    ORDER BY id
  `, [articles]);
  return result.rows.map((row) => Number(row.id));
}

async function captureMembershipFixture(articles) {
  const productIds = await productIdsForArticles(articles);
  const result = productIds.length
    ? await pool.query(`
      SELECT *
      FROM product_customer_categories
      WHERE product_id = ANY($1::integer[])
      ORDER BY product_id, customer_category_id
    `, [productIds])
    : { rows: [] };
  return { productIds, rows: result.rows };
}

async function restoreMembershipFixture({ productIds, rows }) {
  if (!productIds.length) return;
  await pool.query("BEGIN");
  try {
    await pool.query(`
      DELETE FROM product_customer_categories
      WHERE product_id = ANY($1::integer[])
    `, [productIds]);
    for (const row of rows) {
      await pool.query(`
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
        ) VALUES(
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
      `, [
        row.product_id,
        row.customer_category_id,
        row.is_primary,
        row.assignment_source,
        row.assignment_origin,
        row.rule_code,
        row.rule_version,
        row.confidence,
        row.approval_status,
        row.assigned_at,
        row.approved_at,
        row.approved_by,
        row.updated_at,
      ]);
    }
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function seedHistoricalExhaustMemberships() {
  const productIds = await productIdsForArticles(historicalExhaustArticles);
  assert.equal(productIds.length, 9, "isolated fixture must contain all Exhaust products");
  const category = await pool.query(`
    SELECT id
    FROM customer_categories
    WHERE slug = 'exhaust-mounts'
      AND status = 'ACTIVE'
      AND is_active = TRUE
  `);
  assert.equal(category.rowCount, 1);
  const categoryIdValue = Number(category.rows[0].id);
  const historicalRule = await pool.query(`
    SELECT 1
    FROM customer_classification_rules
    WHERE code = 'EXHAUST_MOUNT_A_EPC49_V1'
      AND version = 2
      AND target_category_id = $1
  `, [categoryIdValue]);
  assert.equal(historicalRule.rowCount, 1);
  await pool.query(`
    DELETE FROM product_customer_categories
    WHERE product_id = ANY($1::integer[])
  `, [productIds]);
  for (const productId of productIds) {
    await pool.query(`
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
      ) VALUES(
        $1, $2, TRUE, 'RULE', 'BACKFILL',
        'EXHAUST_MOUNT_A_EPC49_V1', 2,
        'HIGH', 'AUTO_APPROVED',
        clock_timestamp(), clock_timestamp(), NULL, clock_timestamp()
      )
    `, [productId, categoryIdValue]);
  }
}

async function resetTargetMemberships() {
  const products = await targetProducts();
  const steeringId = await categoryId(PHASE3C_STEERING_RULE.currentCategory);
  const productIds = products.map((product) => product.id);
  await pool.query("BEGIN");
  try {
    await pool.query(`
      UPDATE customer_categories
      SET status = 'ACTIVE', is_active = TRUE
      WHERE slug = $1
    `, [PHASE3C_STEERING_RULE.targetCategory]);
    await pool.query(`
      UPDATE customer_classification_rules
      SET is_active = TRUE
      WHERE code = $1 AND version = $2
    `, [PHASE3C_STEERING_RULE.code, PHASE3C_STEERING_RULE.version]);
    await pool.query(`
      DELETE FROM product_customer_categories
      WHERE product_id = ANY($1::integer[])
    `, [productIds]);
    for (const product of products) {
      await pool.query(`
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
        ) VALUES(
          $1, $2, TRUE, 'EPC_FALLBACK', 'BACKFILL', NULL, NULL,
          'MEDIUM', 'AUTO_APPROVED', clock_timestamp(),
          clock_timestamp(), NULL, clock_timestamp()
        )
      `, [product.id, steeringId]);
    }
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
  return products;
}

async function targetMembershipSnapshot() {
  const products = await targetProducts();
  const result = await pool.query(`
    SELECT
      membership.product_id,
      category.slug AS category_slug,
      membership.is_primary,
      membership.assignment_source,
      membership.assignment_origin,
      membership.rule_code,
      membership.rule_version,
      membership.confidence,
      membership.approval_status,
      membership.assigned_at,
      membership.approved_at,
      membership.approved_by,
      membership.updated_at
    FROM product_customer_categories membership
    JOIN customer_categories category
      ON category.id = membership.customer_category_id
    WHERE membership.product_id = ANY($1::integer[])
    ORDER BY membership.product_id, membership.customer_category_id
  `, [products.map((product) => product.id)]);
  return result.rows;
}

async function exhaustSnapshot() {
  const result = await pool.query(`
    SELECT
      product.article_normalized,
      membership.product_id,
      membership.customer_category_id,
      membership.is_primary,
      membership.assignment_source,
      membership.assignment_origin,
      membership.rule_code,
      membership.rule_version,
      membership.confidence,
      membership.approval_status,
      membership.assigned_at,
      membership.approved_at,
      membership.updated_at
    FROM products product
    JOIN product_customer_categories membership ON membership.product_id = product.id
    WHERE product.article_normalized = ANY($1::text[])
    ORDER BY product.article_normalized, membership.customer_category_id
  `, [historicalExhaustArticles]);
  assert.equal(result.rowCount, 9);
  return result.rows;
}

async function unrelatedSnapshot() {
  const result = await pool.query(`
    SELECT membership.*
    FROM product_customer_categories membership
    JOIN products product ON product.id = membership.product_id
    WHERE product.article_normalized = $1
    LIMIT 1
  `, [historicalExhaustArticles[0]]);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function upgradeOneTarget(productId) {
  const currentCategoryId = await categoryId(PHASE3C_STEERING_RULE.currentCategory);
  const targetCategoryId = await categoryId(PHASE3C_STEERING_RULE.targetCategory);
  const updated = await CustomerTaxonomyPhase3CSteeringUpgradeRepository
    .upgradeMembershipInPlace({
      productId,
      currentCategoryId,
      targetCategoryId,
      ruleCode: PHASE3C_STEERING_RULE.code,
      ruleVersion: PHASE3C_STEERING_RULE.version,
    }, pool);
  assert.ok(updated);
}

async function applyUpgrade(options = {}) {
  return runPhase3CSteeringUpgrade({
    mode: "APPLY",
    expectedCount: 2,
    confirmation: PHASE3C_STEERING_CONFIRMATION,
    dbPool: pool,
    ...options,
  });
}

test("PHASE 3C steering upgrade is controlled, atomic and idempotent", async (t) => {
  const fixture = await captureMembershipFixture([
    ...PHASE3C_STEERING_ARTICLES,
    ...historicalExhaustArticles,
  ]);
  await seedHistoricalExhaustMemberships();
  await resetTargetMemberships();
  try {
    await t.test("argument parser requires explicit apply confirmation", () => {
      assert.deepEqual(parsePhase3CSteeringUpgradeArguments([]), {
        mode: "DRY_RUN",
        expectedCount: 2,
        confirmation: null,
      });
      assert.throws(
        () => parsePhase3CSteeringUpgradeArguments(["--apply"]),
        /requires --confirm=PHASE3C_STEERING_PUMPS/,
      );
      assert.deepEqual(parsePhase3CSteeringUpgradeArguments([
        "--apply",
        "--confirm=PHASE3C_STEERING_PUMPS",
        "--expected-count=2",
      ]), {
        mode: "APPLY",
        expectedCount: 2,
        confirmation: "PHASE3C_STEERING_PUMPS",
      });
    });

    await t.test("dry-run finds exactly two targets and performs zero writes", async () => {
      await resetTargetMemberships();
      const before = await targetMembershipSnapshot();
      const report = await runPhase3CSteeringUpgrade({ dbPool: pool });
      const after = await targetMembershipSnapshot();
      assert.equal(report.mode, "DRY_RUN");
      assert.equal(report.targetCount, 2);
      assert.equal(report.wouldUpdate, 2);
      assert.equal(report.alreadyUpgraded, 0);
      assert.equal(report.updated, 0);
      assert.deepEqual(report.errors, []);
      assert.deepEqual(after, before);
    });

    await t.test("wrong precondition aborts the entire operation", async () => {
      const products = await resetTargetMemberships();
      const wrongCategoryId = await categoryId("exhaust");
      const steeringId = await categoryId(PHASE3C_STEERING_RULE.currentCategory);
      await pool.query(`
        UPDATE product_customer_categories
        SET customer_category_id = $2
        WHERE product_id = $1 AND customer_category_id = $3
      `, [products[0].id, wrongCategoryId, steeringId]);
      await assert.rejects(applyUpgrade(), (error) => {
        assert.ok(error instanceof CustomerTaxonomyPhase3CSteeringUpgradeError);
        assert.ok(error.report.errors.some((item) => item.startsWith("MEMBERSHIP_STATE:")));
        return true;
      });
      const rows = await targetMembershipSnapshot();
      assert.equal(rows.find((row) => Number(row.product_id) === products[1].id).category_slug, "steering");
    });

    await t.test("missing target category aborts", async () => {
      await resetTargetMemberships();
      const repository = {
        ...CustomerTaxonomyPhase3CSteeringUpgradeRepository,
        async getCategoryBySlug(slug, db) {
          if (slug === PHASE3C_STEERING_RULE.targetCategory) return null;
          return CustomerTaxonomyPhase3CSteeringUpgradeRepository.getCategoryBySlug(slug, db);
        },
      };
      await assert.rejects(applyUpgrade({ repository }), (error) => {
        assert.ok(error.report.errors.includes("MISSING_TARGET_CATEGORY:steering-pumps"));
        return true;
      });
      assert.equal((await targetMembershipSnapshot()).every((row) => row.category_slug === "steering"), true);
    });

    await t.test("inactive rule aborts", async () => {
      await resetTargetMemberships();
      const repository = {
        ...CustomerTaxonomyPhase3CSteeringUpgradeRepository,
        async getRule(options, db) {
          const rule = await CustomerTaxonomyPhase3CSteeringUpgradeRepository.getRule(options, db);
          return { ...rule, isActive: false };
        },
      };
      await assert.rejects(applyUpgrade({ repository }), (error) => {
        assert.ok(error.report.errors.includes("INACTIVE_TARGET_RULE"));
        return true;
      });
    });

    await t.test("detector mismatch aborts", async () => {
      await resetTargetMemberships();
      await assert.rejects(applyUpgrade({ detector: () => [] }), (error) => {
        assert.equal(error.report.errors.filter((item) => item.startsWith("DETECTOR_MISMATCH:")).length, 2);
        return true;
      });
      assert.equal((await targetMembershipSnapshot()).every((row) => row.category_slug === "steering"), true);
    });

    await t.test("partial target set aborts without updating the remaining product", async () => {
      const products = await resetTargetMemberships();
      await upgradeOneTarget(products[0].id);
      await assert.rejects(applyUpgrade(), (error) => {
        assert.ok(error.report.errors.includes("PARTIAL_TARGET_STATE"));
        return true;
      });
      const rows = await targetMembershipSnapshot();
      assert.equal(rows.filter((row) => row.category_slug === "steering-pumps").length, 1);
      assert.equal(rows.filter((row) => row.category_slug === "steering").length, 1);
    });

    await t.test("apply upgrades exactly two rows and preserves unrelated and Exhaust rows", async () => {
      await resetTargetMemberships();
      const beforeTargets = await targetMembershipSnapshot();
      const beforeUnrelated = await unrelatedSnapshot();
      const beforeExhaust = await exhaustSnapshot();
      const report = await applyUpgrade();
      const afterTargets = await targetMembershipSnapshot();
      assert.equal(report.updated, 2);
      assert.equal(report.verification.correctTarget, 2);
      assert.equal(report.verification.duplicatePrimary, 0);
      assert.equal(report.verification.secondaryMemberships, 0);
      assert.deepEqual(report.globalIntegrity, {
        duplicatePrimary: 0,
        orphanRule: 0,
        inactiveTarget: 0,
      });
      assert.equal(afterTargets.length, 2);
      for (const row of afterTargets) {
        assert.equal(row.category_slug, "steering-pumps");
        assert.equal(row.assignment_source, "RULE");
        assert.equal(row.assignment_origin, "BACKFILL");
        assert.equal(row.confidence, "HIGH");
        assert.equal(row.approval_status, "AUTO_APPROVED");
        assert.equal(row.is_primary, true);
        assert.equal(row.rule_code, PHASE3C_STEERING_RULE.code);
        assert.equal(Number(row.rule_version), PHASE3C_STEERING_RULE.version);
        const previous = beforeTargets.find((item) => item.product_id === row.product_id);
        assert.ok(
          new Date(row.assigned_at).getTime() > new Date(previous.assigned_at).getTime(),
        );
        assert.ok(
          new Date(row.approved_at).getTime() > new Date(previous.approved_at).getTime(),
        );
      }
      assert.deepEqual(await unrelatedSnapshot(), beforeUnrelated);
      assert.deepEqual(await exhaustSnapshot(), beforeExhaust);
    });

    await t.test("second apply is idempotent", async () => {
      await resetTargetMemberships();
      const first = await applyUpgrade();
      assert.equal(first.updated, 2);
      const before = await targetMembershipSnapshot();
      const report = await applyUpgrade();
      const after = await targetMembershipSnapshot();
      assert.equal(report.targetCount, 2);
      assert.equal(report.alreadyUpgraded, 2);
      assert.equal(report.wouldUpdate, 0);
      assert.equal(report.updated, 0);
      assert.deepEqual(report.errors, []);
      assert.deepEqual(after, before);
    });

    await t.test("verify reports exact target and global integrity", async () => {
      const current = await targetMembershipSnapshot();
      if (!current.every((row) => row.category_slug === "steering-pumps")) {
        await resetTargetMemberships();
        await applyUpgrade();
      }
      const report = await runPhase3CSteeringUpgrade({
        mode: "VERIFY",
        expectedCount: 2,
        dbPool: pool,
      });
      assert.deepEqual(report.verification, {
        targetCount: 2,
        correctTarget: 2,
        wrongCategory: 0,
        wrongSource: 0,
        wrongConfidence: 0,
        wrongRule: 0,
        duplicatePrimary: 0,
        secondaryMemberships: 0,
      });
      assert.deepEqual(report.globalIntegrity, {
        duplicatePrimary: 0,
        orphanRule: 0,
        inactiveTarget: 0,
      });
      assert.deepEqual(report.errors, []);
    });
  } finally {
    await restoreMembershipFixture(fixture);
  }
});
