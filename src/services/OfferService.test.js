import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../config/db.js";
import { OfferService } from "./OfferService.js";

after(async () => {
  await pool.end();
});

test("возвращает подготовленные предложения товара", async () => {
  const offers = await OfferService.getOffersByProductId(2);

  assert.ok(Array.isArray(offers));
  assert.equal(offers.length, 1);

  const offer = offers[0];

  assert.equal(offer.productId, 2);
  assert.equal(offer.sourceType, "OWN_STOCK");
  assert.equal(offer.quantity, 4);
  assert.equal(offer.displayQuantity, "4");
  assert.equal(offer.purchasePrice, 350);
  assert.equal(offer.retailPrice, 520);
  assert.equal(offer.deliveryDays, 0);
  assert.equal(offer.isAvailable, true);
  assert.equal(offer.availabilityText, "Есть сегодня");

  assert.deepEqual(offer.warehouse, {
    name: "Основной склад Mercedes",
    city: "Харьков",
  });

  assert.equal(offer.supplier, null);
});