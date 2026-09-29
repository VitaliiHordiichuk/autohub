import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { WarehouseRepository } from "../src/repositories/WarehouseRepository.js";
import { AdminWarehouseOfferService } from "../src/services/AdminWarehouseOfferService.js";

after(async () => {
  await pool.end();
});

test("admin persists warehouse and offer return-policy overrides in PostgreSQL", async () => {
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const article = `RETURNPOLICY${suffix}`;
  let warehouseId = null;
  let productId = null;
  let offerId = null;

  try {
    const warehouse = await pool.query(`
      INSERT INTO warehouses(name, city, type)
      VALUES($1, 'Test city', 'OWN')
      RETURNING id
    `, [`Return policy warehouse ${suffix}`]);
    warehouseId = Number(warehouse.rows[0].id);

    const product = await pool.query(`
      INSERT INTO products(article, article_normalized, name, is_active)
      VALUES($1, $1, 'Return policy fixture', TRUE)
      RETURNING id
    `, [article]);
    productId = Number(product.rows[0].id);

    const offer = await pool.query(`
      INSERT INTO product_offers(
        product_id, warehouse_id, quantity,
        purchase_price, retail_price, minimum_sale_price,
        delivery_days, is_available, source_type,
        price_mode, is_hidden
      )
      VALUES($1, $2, 2, 80, 120, 100, 0, TRUE, 'OWN_STOCK', 'AUTO', FALSE)
      RETURNING id
    `, [productId, warehouseId]);
    offerId = Number(offer.rows[0].id);

    await WarehouseRepository.update(warehouseId, {
      returnPolicyOverride: "NON_RETURNABLE",
      returnPolicyNote: "Warehouse rule",
    });
    const storedWarehouse = (await pool.query(`
      SELECT return_policy_override, return_policy_note, returnable_by_default
      FROM warehouses WHERE id = $1
    `, [warehouseId])).rows[0];
    assert.equal(storedWarehouse.return_policy_override, "NON_RETURNABLE");
    assert.equal(storedWarehouse.return_policy_note, "Warehouse rule");
    assert.equal(storedWarehouse.returnable_by_default, false);

    const saved = await AdminWarehouseOfferService.setReturnability({
      warehouseId,
      offerId,
      returnPolicyOverride: "NON_RETURNABLE",
      returnPolicyNote: "Special order",
    });
    assert.equal(saved.offer.returnPolicyOverride, "NON_RETURNABLE");
    assert.deepEqual(saved.offer.effectiveReturnPolicy, {
      policy: "NON_RETURNABLE",
      source: "OFFER",
    });
    assert.equal(saved.offer.isReturnable, false);

    const listed = await AdminWarehouseOfferService.listOffers({
      warehouseId,
      search: article,
      status: "ALL",
      locale: "uk",
      page: 1,
      limit: 100,
    });
    assert.equal(listed.offers.length, 1);
    assert.equal(listed.offers[0].returnPolicyOverride, "NON_RETURNABLE");
    assert.equal(listed.offers[0].returnPolicyNote, "Special order");
    assert.deepEqual(listed.offers[0].effectiveReturnPolicy, {
      policy: "NON_RETURNABLE",
      source: "OFFER",
    });
    assert.equal(listed.offers[0].isReturnable, false);

    const storedOffer = (await pool.query(`
      SELECT return_policy_override, return_policy_note, is_returnable
      FROM product_offers WHERE id = $1
    `, [offerId])).rows[0];
    assert.equal(storedOffer.return_policy_override, "NON_RETURNABLE");
    assert.equal(storedOffer.return_policy_note, "Special order");
    assert.equal(storedOffer.is_returnable, false);

    const inherited = await AdminWarehouseOfferService.setReturnability({
      warehouseId,
      offerId,
      returnPolicyOverride: "INHERIT",
      returnPolicyNote: null,
    });
    assert.equal(inherited.offer.returnPolicyOverride, "INHERIT");
    assert.deepEqual(inherited.offer.effectiveReturnPolicy, {
      policy: "NON_RETURNABLE",
      source: "WAREHOUSE",
    });
    const legacy = (await pool.query(
      "SELECT is_returnable FROM product_offers WHERE id = $1",
      [offerId]
    )).rows[0];
    assert.equal(legacy.is_returnable, null);
  } finally {
    if (offerId) await pool.query("DELETE FROM product_offers WHERE id = $1", [offerId]);
    if (productId) await pool.query("DELETE FROM products WHERE id = $1", [productId]);
    if (warehouseId) await pool.query("DELETE FROM warehouses WHERE id = $1", [warehouseId]);
  }
});
