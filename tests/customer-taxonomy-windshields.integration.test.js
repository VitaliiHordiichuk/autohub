import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { CustomerTaxonomyRepository } from "../src/repositories/CustomerTaxonomyRepository.js";
import { CustomerTaxonomyImportService } from "../src/services/CustomerTaxonomyImportService.js";
import {
  CustomerTaxonomyWindshieldBackfillError,
  WINDSHIELD_BACKFILL_CONFIRMATION,
  buildWindshieldBackfillPlan,
  parseWindshieldBackfillArguments,
  runWindshieldBackfill,
} from "../src/services/CustomerTaxonomyWindshieldBackfillService.js";

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

async function createProduct(article, name, translations = []) {
  const result = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, $2, TRUE)
    RETURNING id
  `, [article, name]);
  const id = Number(result.rows[0].id);
  createdProductIds.push(id);
  for (const [languageCode, translatedName] of translations) {
    await pool.query(`
      INSERT INTO product_translations(product_id, language_code, name)
      VALUES($1, $2, $3)
      ON CONFLICT(product_id, language_code) DO UPDATE SET name = EXCLUDED.name
    `, [id, languageCode, translatedName]);
  }
  return id;
}

async function categoryId(slug) {
  const result = await pool.query("SELECT id FROM customer_categories WHERE slug = $1", [slug]);
  assert.equal(result.rowCount, 1, slug);
  return Number(result.rows[0].id);
}

async function insertPrimary({ productId, slug, source, origin, confidence, status }) {
  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, is_primary,
      assignment_source, assignment_origin, rule_code, rule_version,
      confidence, approval_status, approved_at
    ) VALUES($1, $2, TRUE, $3, $4, NULL, NULL, $5, $6, NOW())
  `, [productId, await categoryId(slug), source, origin, confidence, status]);
}

after(async () => {
  if (createdProductIds.length) {
    await pool.query(
      "DELETE FROM product_customer_categories WHERE product_id = ANY($1::integer[])",
      [createdProductIds],
    );
    await pool.query(
      "DELETE FROM product_translations WHERE product_id = ANY($1::integer[])",
      [createdProductIds],
    );
    await pool.query("DELETE FROM products WHERE id = ANY($1::integer[])", [createdProductIds]);
  }
  await pool.end();
});

test("migration 104 adds the localized windshield leaf and one active v10 rule", async () => {
  const category = await pool.query(`
    SELECT child.slug, parent.slug AS parent_slug, child.status, child.is_active,
           COUNT(translation.language_code)::integer AS translations
    FROM customer_categories child
    JOIN customer_categories parent ON parent.id = child.parent_id
    LEFT JOIN customer_category_translations translation ON translation.category_id = child.id
    WHERE child.slug = 'body-windshields'
    GROUP BY child.id, parent.slug
  `);
  assert.deepEqual(category.rows[0], {
    slug: "body-windshields",
    parent_slug: "body-glass",
    status: "ACTIVE",
    is_active: true,
    translations: 3,
  });
  const rule = await pool.query(`
    SELECT rule.code, rule.version, rule.detector_version, rule.match_value,
           rule.confidence, rule.auto_approval_allowed, target.slug AS target_slug
    FROM customer_classification_rules rule
    JOIN customer_categories target ON target.id = rule.target_category_id
    WHERE rule.code = 'GLASS_WINDSHIELD_A_EPC67_V1' AND rule.is_active = TRUE
  `);
  assert.deepEqual(rule.rows, [{
    code: "GLASS_WINDSHIELD_A_EPC67_V1",
    version: 1,
    detector_version: 10,
    match_value: "GLASS_WINDSHIELD",
    confidence: "HIGH",
    auto_approval_allowed: true,
    target_slug: "body-windshields",
  }]);
});

test("controlled backfill inserts new leaf, upgrades SAFE root, preserves MANUAL and is idempotent", async () => {
  const insertId = await createProduct("A9006700001", "WINDSCH.SCHEIBE", [["uk", "Вітрове скло"]]);
  const upgradeId = await createProduct("A9016700002", "Лобовое стекло");
  const manualId = await createProduct("A9026700003", "Windscreen");
  const relatedId = await createProduct("A9036700004", "Windscreen seal");
  await insertPrimary({
    productId: upgradeId,
    slug: "body-glass",
    source: "EPC_FALLBACK",
    origin: "BACKFILL",
    confidence: "MEDIUM",
    status: "AUTO_APPROVED",
  });
  await insertPrimary({
    productId: manualId,
    slug: "body-side-windows",
    source: "MANUAL",
    origin: "ADMIN",
    confidence: "HIGH",
    status: "MANUAL_APPROVED",
  });
  const ids = [insertId, upgradeId, manualId, relatedId];
  const repository = scopedRepository(ids);

  const dry = await runWindshieldBackfill({ repository });
  assert.equal(dry.mode, "DRY_RUN");
  assert.equal(dry.detectedCount, 3);
  assert.equal(dry.outstandingCount, 2);
  assert.equal(dry.insertCount, 1);
  assert.equal(dry.upgradeSafeRootCount, 1);
  assert.equal(dry.preservedManualCount, 1);
  assert.equal(dry.candidates.some((item) => item.productId === relatedId), false);

  const applied = await runWindshieldBackfill({
    mode: "APPLY",
    confirmation: WINDSHIELD_BACKFILL_CONFIRMATION,
    expectedCount: 2,
    repository,
  });
  assert.equal(applied.applied, 2);
  assert.equal(applied.verification.remainingOutstanding, 0);
  assert.equal(applied.verification.duplicatePrimary, 0);

  const memberships = await CustomerTaxonomyRepository.listMemberships(pool);
  const targetRows = memberships.filter((membership) => ids.includes(membership.productId));
  for (const id of [insertId, upgradeId]) {
    const primary = targetRows.find((membership) => membership.productId === id && membership.isPrimary);
    assert.equal(primary.categorySlug, "body-windshields");
    assert.equal(primary.assignmentSource, "RULE");
    assert.equal(primary.assignmentOrigin, "BACKFILL");
    assert.equal(primary.confidence, "HIGH");
    assert.equal(primary.approvalStatus, "AUTO_APPROVED");
  }
  const manualPrimary = targetRows.find((membership) => membership.productId === manualId && membership.isPrimary);
  assert.equal(manualPrimary.categorySlug, "body-side-windows");
  assert.equal(manualPrimary.assignmentSource, "MANUAL");

  const repeated = await runWindshieldBackfill({
    mode: "APPLY",
    confirmation: WINDSHIELD_BACKFILL_CONFIRMATION,
    expectedCount: 2,
    repository,
  });
  assert.equal(repeated.idempotentNoop, true);
  assert.equal(repeated.applied, 0);
});

test("apply requires explicit confirmation/count and rolls back a mismatched count", async () => {
  assert.deepEqual(parseWindshieldBackfillArguments([]), {
    mode: "DRY_RUN",
    confirmation: null,
    expectedCount: null,
  });
  assert.throws(
    () => parseWindshieldBackfillArguments(["--apply", `--confirm=${WINDSHIELD_BACKFILL_CONFIRMATION}`]),
    /expected-count/,
  );

  const id = await createProduct("A9046700005", "Скло лобове");
  const repository = scopedRepository([id]);
  await assert.rejects(
    () => runWindshieldBackfill({
      mode: "APPLY",
      confirmation: WINDSHIELD_BACKFILL_CONFIRMATION,
      expectedCount: 2,
      repository,
    }),
    error => error instanceof CustomerTaxonomyWindshieldBackfillError
      && error.report.errors.includes("EXPECTED_COUNT_MISMATCH:2:1"),
  );
  const rows = await CustomerTaxonomyRepository.listMembershipsForProduct(id, pool);
  assert.equal(rows.length, 0);
});

test("future and repeated imports classify a verified EPC67 windshield into the leaf", async () => {
  const id = await createProduct("A9056700006", "WINDSCHUTZSCHEIBE");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const context = await CustomerTaxonomyImportService.createContext({ db: client });
    const first = await CustomerTaxonomyImportService.classifyProduct({
      productId: id,
      context,
    }, { db: client });
    assert.equal(first.finalCategory, "body-windshields");
    assert.equal(first.assignmentSource, "RULE");
    assert.equal(first.confidence, "HIGH");
    const repeated = await CustomerTaxonomyImportService.classifyProduct({
      productId: id,
      context,
    }, { db: client });
    assert.equal(repeated.finalCategory, "body-windshields");
    assert.equal(repeated.preservedExisting, true);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const [membership] = await CustomerTaxonomyRepository.listMembershipsForProduct(id, pool);
  assert.equal(membership.categorySlug, "body-windshields");
  assert.equal(membership.assignmentOrigin, "IMPORT");
  assert.equal(membership.ruleCode, "GLASS_WINDSHIELD_A_EPC67_V1");
});

test("planner rejects generic EPC67 glass and non-EPC windshield wording", () => {
  const plan = buildWindshieldBackfillPlan({
    products: [
      { id: 1, article: "A447670010064", articleNormalized: "A447670010064", name: "GLASS", technicalEpcGroups: ["67"] },
      { id: 2, article: "A2118250610", articleNormalized: "A2118250610", name: "Windscreen", technicalEpcGroups: ["82"] },
    ],
    memberships: [],
    rules: [],
  });
  assert.equal(plan.detected.length, 0);
});
