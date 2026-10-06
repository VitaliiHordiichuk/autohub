import assert from "node:assert/strict";
import test from "node:test";

import { pool } from "../src/config/db.js";
import { CustomerTaxonomyRepository } from "../src/repositories/CustomerTaxonomyRepository.js";
import { CustomerTaxonomyAssignmentService } from "../src/services/CustomerTaxonomyAssignmentService.js";
import {
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_TAXONOMY_DECISION,
  resolveCustomerTaxonomy,
} from "../src/services/CustomerTaxonomyResolver.js";

const exhaustArticles = [
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
const steeringArticles = ["A0024662201", "A0024668801"];
let fixtureSequence = 0;

async function category(slug) {
  const result = await pool.query(`
    SELECT id, slug, status, is_active
    FROM customer_categories
    WHERE slug = $1
  `, [slug]);
  assert.equal(result.rowCount, 1, `missing customer category ${slug}`);
  return { ...result.rows[0], id: Number(result.rows[0].id) };
}

async function rule(code, version = null) {
  const parameters = [code];
  let versionPredicate = "AND is_active = TRUE";
  if (version !== null) {
    parameters.push(version);
    versionPredicate = "AND version = $2";
  }
  const result = await pool.query(`
    SELECT *
    FROM customer_classification_rules
    WHERE code = $1 ${versionPredicate}
    ORDER BY version DESC
    LIMIT 1
  `, parameters);
  assert.equal(result.rowCount, 1, `missing rule ${code}@${version ?? "active"}`);
  return result.rows[0];
}

async function productMap(articles) {
  const result = await pool.query(`
    SELECT id, article, article_normalized
    FROM products
    WHERE article_normalized = ANY($1::text[])
    ORDER BY article_normalized
  `, [articles]);
  assert.equal(result.rowCount, articles.length);
  return new Map(result.rows.map((row) => [row.article_normalized, {
    id: Number(row.id),
    article: row.article,
    articleNormalized: row.article_normalized,
  }]));
}

async function captureMemberships(productIds) {
  const result = await pool.query(`
    SELECT *
    FROM product_customer_categories
    WHERE product_id = ANY($1::integer[])
    ORDER BY product_id, customer_category_id
  `, [productIds]);
  return result.rows;
}

async function restoreMemberships(productIds, rows) {
  await pool.query("BEGIN");
  try {
    await pool.query(`
      DELETE FROM product_customer_categories
      WHERE product_id = ANY($1::integer[])
    `, [productIds]);
    for (const row of rows) {
      await pool.query(`
        INSERT INTO product_customer_categories(
          product_id, customer_category_id, is_primary, assignment_source,
          assignment_origin, rule_code, rule_version, confidence,
          approval_status, assigned_at, approved_at, approved_by, updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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

async function insertApprovedRuleMembership({ productId, categoryId, ruleRow }) {
  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, is_primary, assignment_source,
      assignment_origin, rule_code, rule_version, confidence,
      approval_status, assigned_at, approved_at, updated_at
    ) VALUES(
      $1, $2, TRUE, 'RULE', 'BACKFILL', $3, $4,
      'HIGH', 'AUTO_APPROVED', clock_timestamp(), clock_timestamp(), clock_timestamp()
    )
  `, [productId, categoryId, ruleRow.code, Number(ruleRow.version)]);
}

async function seedProductionRegressionMemberships(products) {
  const exhaustCategory = await category("exhaust-mounts");
  const steeringCategory = await category("steering-pumps");
  const exhaustRule = await rule("EXHAUST_MOUNT_A_EPC49_V1", 2);
  const steeringRule = await rule("STEERING_PUMP_A_EPC46_V1", 7);
  assert.equal(exhaustRule.is_active, false);
  assert.equal(steeringRule.is_active, true);
  for (const article of exhaustArticles) {
    await insertApprovedRuleMembership({
      productId: products.get(article).id,
      categoryId: exhaustCategory.id,
      ruleRow: exhaustRule,
    });
  }
  for (const article of steeringArticles) {
    await insertApprovedRuleMembership({
      productId: products.get(article).id,
      categoryId: steeringCategory.id,
      ruleRow: steeringRule,
    });
  }
}

async function createAutomaticFixture(label, ruleRow) {
  fixtureSequence += 1;
  const article = `P3D${process.pid}${Date.now()}${fixtureSequence}`;
  const product = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, $2, TRUE)
    RETURNING id
  `, [article, `PHASE 3D ${label}`]);
  const productId = Number(product.rows[0].id);
  await insertApprovedRuleMembership({
    productId,
    categoryId: Number(ruleRow.target_category_id),
    ruleRow,
  });
  return productId;
}

function proposalFromRule(ruleRow, targetCategory) {
  return {
    category: { id: targetCategory.id, slug: targetCategory.slug },
    isPrimary: true,
    assignmentSource: "RULE",
    assignmentOrigin: "SYSTEM",
    ruleCode: ruleRow.code,
    ruleVersion: Number(ruleRow.version),
    confidence: "HIGH",
    approvalStatus: "AUTO_APPROVED",
  };
}

test("approved primary guard preserves production regressions and controlled overrides", async () => {
  const articles = [...exhaustArticles, ...steeringArticles];
  const products = await productMap(articles);
  const productIds = [...products.values()].map((product) => product.id);
  const baseline = await captureMemberships(productIds);
  const createdProductIds = [];
  try {
    await pool.query(`
      DELETE FROM product_customer_categories
      WHERE product_id = ANY($1::integer[])
    `, [productIds]);
    await seedProductionRegressionMemberships(products);
    const activeRules = await CustomerTaxonomyRepository.listActiveRules(pool);
    const before = await captureMemberships(productIds);

    for (const article of exhaustArticles) {
      const product = {
        ...products.get(article),
        name: "Затискач",
        technicalEpcGroups: ["49"],
      };
      const existing = await CustomerTaxonomyRepository.listMembershipsForProduct(
        product.id,
        pool,
      );
      assert.equal(existing.length, 1);
      assert.equal(existing[0].historicalRuleExists, true);
      assert.equal(existing[0].historicalRuleIsActive, false);
      assert.equal(existing[0].categoryIsActive, true);
      const resolution = resolveCustomerTaxonomy({
        product,
        rules: activeRules,
        existingMemberships: existing,
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT,
      });
      assert.equal(resolution.typeCodes.includes("EXHAUST_MOUNT"), false);
      assert.equal(
        resolution.decision,
        CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
      );
      const result = await CustomerTaxonomyAssignmentService.applyResolution({
        productId: product.id,
        resolution,
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT,
      }, { dbPool: pool });
      assert.equal(
        result.decision,
        CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
      );
      assert.equal(result.applied.length, 0);
    }

    for (const article of steeringArticles) {
      const product = {
        ...products.get(article),
        name: "Гідронасос",
        technicalEpcGroups: ["46"],
      };
      const existing = await CustomerTaxonomyRepository.listMembershipsForProduct(
        product.id,
        pool,
      );
      const resolution = resolveCustomerTaxonomy({
        product,
        rules: activeRules,
        existingMemberships: existing,
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT,
      });
      assert.deepEqual(resolution.typeCodes, ["STEERING_PUMP"]);
      assert.equal(resolution.proposals[0].category.slug, "steering-pumps");
      const result = await CustomerTaxonomyAssignmentService.applyResolution({
        productId: product.id,
        resolution,
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT,
      }, { dbPool: pool });
      assert.equal(
        result.decision,
        CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
      );
      assert.equal(result.applied.length, 0);
    }
    assert.deepEqual(await captureMemberships(productIds), before);

    const filterRule = await rule("FILTER_OIL_A_EPC18_V1");
    const brakeRule = await rule("BRAKE_PAD_A_EPC42_V1");
    const brakesPads = await category("brakes-pads");
    const unrelatedProductId = await createAutomaticFixture("UNRELATED", filterRule);
    createdProductIds.push(unrelatedProductId);
    const unrelatedBefore = await captureMemberships([unrelatedProductId]);
    const overrideProductId = await createAutomaticFixture("OVERRIDE", filterRule);
    createdProductIds.push(overrideProductId);
    const overrideResult = await CustomerTaxonomyAssignmentService.applyResolution({
      productId: overrideProductId,
      resolution: { proposals: [proposalFromRule(brakeRule, brakesPads)] },
      assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.SYSTEM,
      allowApprovedPrimaryReplacement: true,
      approvedPrimaryReplacementReason: "PHASE 3D integration test",
    }, { dbPool: pool });
    assert.equal(
      overrideResult.decision,
      CUSTOMER_TAXONOMY_DECISION.REPLACED_BY_EXPLICIT_OVERRIDE,
    );
    const overridden = await pool.query(`
      SELECT customer_category_id, is_primary
      FROM product_customer_categories
      WHERE product_id = $1
      ORDER BY customer_category_id
    `, [overrideProductId]);
    assert.equal(overridden.rowCount, 2);
    assert.equal(overridden.rows.filter((row) => row.is_primary).length, 1);
    assert.equal(
      Number(overridden.rows.find((row) => row.is_primary).customer_category_id),
      brakesPads.id,
    );

    const rollbackProductId = await createAutomaticFixture("ROLLBACK", filterRule);
    createdProductIds.push(rollbackProductId);
    const failingRepository = {
      ...CustomerTaxonomyRepository,
      async upsertMembership(input, db) {
        await CustomerTaxonomyRepository.upsertMembership(input, db);
        throw new Error("simulated PostgreSQL assignment failure");
      },
    };
    await assert.rejects(CustomerTaxonomyAssignmentService.applyResolution({
      productId: rollbackProductId,
      resolution: { proposals: [proposalFromRule(brakeRule, brakesPads)] },
      assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.SYSTEM,
      allowApprovedPrimaryReplacement: true,
      approvedPrimaryReplacementReason: "PHASE 3D rollback test",
    }, { dbPool: pool, repository: failingRepository }), /simulated PostgreSQL assignment failure/);
    const rolledBack = await pool.query(`
      SELECT customer_category_id, is_primary
      FROM product_customer_categories
      WHERE product_id = $1
    `, [rollbackProductId]);
    assert.equal(rolledBack.rowCount, 1);
    assert.equal(rolledBack.rows[0].is_primary, true);
    assert.equal(Number(rolledBack.rows[0].customer_category_id), Number(filterRule.target_category_id));
    assert.deepEqual(await captureMemberships([unrelatedProductId]), unrelatedBefore);
    assert.deepEqual(await captureMemberships(productIds), before);
  } finally {
    if (createdProductIds.length) {
      await pool.query(`
        DELETE FROM products
        WHERE id = ANY($1::integer[])
      `, [createdProductIds]);
    }
    await restoreMemberships(productIds, baseline);
    await pool.end();
  }
});
