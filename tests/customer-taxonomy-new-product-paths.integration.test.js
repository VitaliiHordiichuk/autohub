import assert from "node:assert/strict";
import test from "node:test";

import { pool } from "../src/config/db.js";
import { AdminWarehouseOfferService } from "../src/services/AdminWarehouseOfferService.js";

test("manual admin creation classifies explicit new parts without altering offers", async () => {
  const previousFlag = process.env.CUSTOMER_TAXONOMY_IMPORT_ENABLED;
  process.env.CUSTOMER_TAXONOMY_IMPORT_ENABLED = "true";
  const createdIds = [];
  const suffix = String((Date.now() + process.pid) % 100000).padStart(5, "0");
  const cases = [
    ["67", "Скло лобове", "body-windshields"],
    ["90", "Фара головного світла", "lighting-headlights"],
    ["82", "Задній ліхтар", "electrical-electronics-lighting"],
    ["88", "Накладка бампера", null], // conflicting approved bumper category: review, not an automatic leaf
    ["47", "Повітряний фільтр двигуна", "filters-engine-air"],
    ["24", "Подушка двигуна", "engine-mounts"],
    ["32", "Амортизатор", "suspension-shock-absorbers"],
    ["69", "Підкрилок", "body-wheel-arch-liners"],
    ["88", "Крило передне", "body-fenders"],
    ["88", "Кронштейн бампера", "body-bumper-mounts"],
    ["73", "Замок дверей", "body-locks-latches"],
    ["54", "Блок запобіжників", "electrical-fuse-boxes"],
    ["98", "Акумулятор 12V/60Ah", "electrical-batteries"],
    ["33", "Сайлентблок важіля підвіски", "suspension-bushings-mounts"],
    ["05", "Шестерня валу розподільчого", "engine-timing-components"],
    ["01", "Щуп оливи двигуна", "engine-oil-system-components"],
  ];
  try {
    const brand = await pool.query(`
      SELECT id FROM brands WHERE LOWER(name) = LOWER('Mercedes-Benz') LIMIT 1
    `);
    const warehouse = await pool.query(`
      SELECT id FROM warehouses WHERE is_active = TRUE ORDER BY id LIMIT 1
    `);
    assert.equal(brand.rowCount, 1);
    assert.equal(warehouse.rowCount, 1);
    for (const [index, [epc, name, expectedSlug]] of cases.entries()) {
      const uniqueSuffix = String((Number(suffix) + index) % 100000).padStart(5, "0");
      const article = `A998${epc}${uniqueSuffix}`;
      const saved = await AdminWarehouseOfferService.addManualPosition({
        warehouseId: Number(warehouse.rows[0].id),
        brandId: Number(brand.rows[0].id),
        article,
        name,
        quantity: 3,
        purchasePrice: 100,
      });
      assert.equal(saved.productCreated, true, article);
      createdIds.push(Number(saved.product.id));
      const result = await pool.query(`
        SELECT category.slug, membership.assignment_source,
               membership.assignment_origin, membership.is_primary,
               offer.quantity, offer.purchase_price
        FROM products product
        JOIN product_offers offer ON offer.product_id = product.id
        LEFT JOIN product_customer_categories membership ON membership.product_id = product.id
        LEFT JOIN customer_categories category ON category.id = membership.customer_category_id
        WHERE product.id = $1
      `, [saved.product.id]);
      assert.equal(result.rows.length, 1, article);
      assert.equal(result.rows[0].slug, expectedSlug, article);
      if (expectedSlug) {
        assert.equal(result.rows[0].assignment_origin, "IMPORT", article);
        assert.equal(result.rows[0].is_primary, true, article);
      }
      assert.equal(Number(result.rows[0].quantity), 3, article);
      assert.equal(Number(result.rows[0].purchase_price), 100, article);
    }
  } finally {
    if (previousFlag === undefined) delete process.env.CUSTOMER_TAXONOMY_IMPORT_ENABLED;
    else process.env.CUSTOMER_TAXONOMY_IMPORT_ENABLED = previousFlag;
    if (createdIds.length) {
      await pool.query("DELETE FROM product_customer_categories WHERE product_id = ANY($1::integer[])", [createdIds]);
      await pool.query("DELETE FROM product_offers WHERE product_id = ANY($1::integer[])", [createdIds]);
      await pool.query("DELETE FROM products WHERE id = ANY($1::integer[])", [createdIds]);
    }
    await pool.end();
  }
});
