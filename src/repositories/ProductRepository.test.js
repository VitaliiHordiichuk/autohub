import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../config/db.js";
import { ProductRepository } from "./ProductRepository.js";

after(async () => {
  await pool.end();
});

test("находит товар по нормализованному артикулу", async () => {
  const product =
    await ProductRepository.findByNormalizedArticle("A2711800109");

  assert.ok(product);

  assert.equal(product.article, "A2711800109");
  assert.equal(product.vehicle_brand, "Mercedes-Benz");
  assert.equal(product.manufacturer, "Mercedes-Benz");
  assert.equal(product.product_type, "ORIGINAL");
  
});
test("находит предложения товара", async () => {
  const offers = await ProductRepository.findOffersByProductId(2);

  assert.ok(Array.isArray(offers));
  assert.equal(offers.length, 1);

  assert.equal(offers[0].quantity, "4.00");
  assert.equal(offers[0].retail_price, "550.00");
  assert.equal(offers[0].source_type, "OWN_STOCK");
  assert.equal(
    offers[0].warehouse_name,
    "Основной склад Mercedes"
  );
});

test("возвращает эффективную ручную цену предложения", async () => {
  const offer =
    await ProductRepository.findOfferById(1);

  assert.ok(offer);
  assert.equal(offer.retailPrice, 550);
  assert.equal(offer.isAvailable, true);
});
