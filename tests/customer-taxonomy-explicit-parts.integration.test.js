import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { CustomerTaxonomyImportService } from "../src/services/CustomerTaxonomyImportService.js";
import { CustomerTaxonomyRepository } from "../src/repositories/CustomerTaxonomyRepository.js";

after(async () => pool.end());

async function inTestTransaction(run) {
  const db = await pool.connect();
  try {
    const { rows: [{ name }] } = await db.query("SELECT current_database() AS name");
    if (!name.endsWith("_test")) throw new Error("Integration fixture requires an isolated *_test database");
    await db.query("BEGIN");
    return await run(db);
  } finally {
    await db.query("ROLLBACK").finally(() => db.release());
  }
}

async function createProduct(db, epc, name, sequence) {
  // The A-number's positions 5–6 carry the technical EPC in the real importer.
  const article = `A998${epc}${String(sequence).padStart(5, "0")}`;
  const { rows: [{ id }] } = await db.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, $2, TRUE)
    RETURNING id
  `, [article, name]);
  return Number(id);
}

test("owner-approved parts receive precise leaves on real import and preserve manual primary", async () => {
  await inTestTransaction(async (db) => {
    const cases = [
      ["98", "Акумулятор 12V/60ah", "electrical-batteries"],
      ["90", "Датчик NOX", "exhaust-sensors"],
      ["35", "Балка моста заднього", "suspension-subframes"],
      ["15", "Клапан тиску", "engine-sensors"],
      ["14", "Насос системи AdBlue", "exhaust-adblue-scr"],
      ["90", "Датчик тиску системи AdBlue", "exhaust-adblue-scr"],
      ["98", "Реагент AdBlue", "exhaust-adblue-scr"],
      ["49", "Форсунка AdBlue", "exhaust-adblue-scr"],
    ];
    const context = await CustomerTaxonomyImportService.createContext({ db });
    for (const [index, [epc, name, expected]] of cases.entries()) {
      const productId = await createProduct(db, epc, name, index + 1);
      const first = await CustomerTaxonomyImportService.classifyProduct({ productId, context }, { db });
      assert.equal(first.finalCategory, expected, name);
      assert.equal(first.confidence, "HIGH", name);
      const repeated = await CustomerTaxonomyImportService.classifyProduct({ productId, context }, { db });
      assert.equal(repeated.finalCategory, expected, name);
      assert.equal(repeated.preservedExisting, true, name);
      const memberships = await CustomerTaxonomyRepository.listMembershipsForProduct(productId, db);
      assert.equal(memberships.filter((item) => item.isPrimary).length, 1, name);
    }

    const protectedId = await createProduct(db, "90", "Датчик NOX", 100);
    const { rows: [{ id: categoryId }] } = await db.query(
      "SELECT id FROM customer_categories WHERE slug = 'filters-oil' AND is_active = TRUE",
    );
    await db.query(`
      INSERT INTO product_customer_categories(
        product_id, customer_category_id, is_primary,
        assignment_source, assignment_origin, confidence, approval_status, approved_at
      ) VALUES($1, $2, TRUE, 'MANUAL', 'ADMIN', 'HIGH', 'MANUAL_APPROVED', NOW())
    `, [protectedId, categoryId]);
    const protectedResult = await CustomerTaxonomyImportService.classifyProduct(
      { productId: protectedId, context }, { db },
    );
    assert.equal(protectedResult.finalCategory, "filters-oil");
    const protectedMemberships = await CustomerTaxonomyRepository.listMembershipsForProduct(protectedId, db);
    assert.equal(protectedMemberships.length, 1);
    assert.equal(protectedMemberships[0].assignmentSource, "MANUAL");

    // A previously approved public leaf is never silently rewritten by the
    // newer AdBlue recognition, even when its current leaf is less specific.
    const approvedId = await createProduct(db, "90", "Датчик тиску системи AdBlue", 101);
    const { rows: [{ id: exhaustSensorId }] } = await db.query(
      "SELECT id FROM customer_categories WHERE slug = 'exhaust-sensors' AND is_active = TRUE",
    );
    const { rows: [{ version: exhaustRuleVersion }] } = await db.query(`
      SELECT version FROM customer_classification_rules
      WHERE code = 'EXHAUST_SENSOR_A_EPC90_V1' AND is_active = TRUE
      ORDER BY version DESC LIMIT 1
    `);
    await db.query(`
      INSERT INTO product_customer_categories(
        product_id, customer_category_id, is_primary,
        assignment_source, assignment_origin, rule_code, rule_version,
        confidence, approval_status, approved_at
      ) VALUES($1, $2, TRUE, 'RULE', 'BACKFILL',
               'EXHAUST_SENSOR_A_EPC90_V1', $3, 'HIGH', 'AUTO_APPROVED', NOW())
    `, [approvedId, exhaustSensorId, exhaustRuleVersion]);
    const approvedResult = await CustomerTaxonomyImportService.classifyProduct(
      { productId: approvedId, context }, { db },
    );
    assert.equal(approvedResult.finalCategory, "exhaust-sensors");
    assert.equal(approvedResult.preservedExisting, true);
  });
});

test("generic or misleading parts do not receive an exact leaf", async () => {
  await inTestTransaction(async (db) => {
    const cases = [
      ["90", "Кронштейн датчика NOx"],
      ["15", "Клапан тиску палива"],
      ["35", "Болт підрамника"],
      ["98", "Кабель акумулятора"],
      ["14", "Насос повітряний"],
    ];
    const context = await CustomerTaxonomyImportService.createContext({ db });
    for (const [index, [epc, name]] of cases.entries()) {
      const productId = await createProduct(db, epc, name, index + 201);
      const result = await CustomerTaxonomyImportService.classifyProduct({ productId, context }, { db });
      assert.equal(result.finalCategory, null, name);
      const memberships = await CustomerTaxonomyRepository.listMembershipsForProduct(productId, db);
      assert.equal(memberships.filter((item) => item.isPrimary).length, 0, name);
    }
  });
});
