import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { GoogleMerchantFeedService } from "../src/services/GoogleMerchantFeedService.js";
import { GoogleMerchantFeedRepository } from "../src/repositories/GoogleMerchantFeedRepository.js";
import {
  GOOGLE_PRODUCT_CATEGORY,
  googleProductCategoryFor,
} from "../src/services/GoogleProductCategoryService.js";
import { PublicSeoService } from "../src/services/PublicSeoService.js";
import { SEARCH_FIXTURE } from "./helpers/search-fixture.js";


const testImageUrl =
  `https://images.example.test/merchant-${Date.now()}.webp`;
let productId;
let offerId;
let originalOffer;


before(async () => {
  const result = await pool.query(`
    SELECT
      p.id AS product_id,
      po.id AS offer_id,
      po.quantity,
      po.retail_price,
      po.minimum_sale_price,
      po.price_mode,
      po.manual_retail_price,
      po.is_available,
      po.is_hidden
    FROM products p
    JOIN product_offers po ON po.product_id = p.id
    WHERE p.article_normalized = $1
      AND po.is_available = TRUE
      AND po.is_hidden = FALSE
      AND po.quantity > 0
    ORDER BY po.id
    LIMIT 1
  `, [SEARCH_FIXTURE.analogNormalized]);
  const row = result.rows[0];
  assert.ok(row, "Тестовое предложение HU718/5X не найдено");
  productId = Number(row.product_id);
  offerId = Number(row.offer_id);
  originalOffer = row;

  await pool.query(`
    INSERT INTO product_images(product_id, url, source, priority)
    VALUES ($1, $2, 'TEST', -1000)
  `, [productId, testImageUrl]);
});


after(async () => {
  if (offerId && originalOffer) {
    await pool.query(`
      UPDATE product_offers
      SET quantity = $2,
          retail_price = $3,
          minimum_sale_price = $4,
          price_mode = $5,
          manual_retail_price = $6,
          is_available = $7,
          is_hidden = $8
      WHERE id = $1
    `, [
      offerId,
      originalOffer.quantity,
      originalOffer.retail_price,
      originalOffer.minimum_sale_price,
      originalOffer.price_mode,
      originalOffer.manual_retail_price,
      originalOffer.is_available,
      originalOffer.is_hidden,
    ]);
  }
  if (productId) {
    await pool.query(
      "DELETE FROM product_images WHERE product_id = $1 AND url = $2",
      [productId, testImageUrl]
    );
  }
  await pool.end();
});


test("manual and automatic feed prices match the public product card", async () => {
  await pool.query(`
    UPDATE product_offers
    SET quantity = 4,
        retail_price = 523.45,
        minimum_sale_price = 400,
        price_mode = 'MANUAL',
        manual_retail_price = 551.23,
        is_available = TRUE,
        is_hidden = FALSE
    WHERE id = $1
  `, [offerId]);

  const publicManual = await PublicSeoService.getProduct({
    article: SEARCH_FIXTURE.analogArticle,
    locale: "uk",
  });
  const feedManual = await GoogleMerchantFeedService.getItems(
    pool,
    { productIds: [productId] }
  );
  const manualItem = feedManual.find((item) =>
    item.mpn === SEARCH_FIXTURE.analogArticle);

  assert.ok(publicManual?.offer);
  assert.ok(manualItem);
  assert.equal(publicManual.offer.price, 551.23);
  assert.equal(manualItem.price, `${publicManual.offer.price.toFixed(2)} UAH`);

  await pool.query(`
    UPDATE product_offers
    SET price_mode = 'AUTO',
        manual_retail_price = NULL
    WHERE id = $1
  `, [offerId]);

  const publicAutomatic = await PublicSeoService.getProduct({
    article: SEARCH_FIXTURE.analogArticle,
    locale: "uk",
  });
  const feedAutomatic = await GoogleMerchantFeedService.getItems(
    pool,
    { productIds: [productId] }
  );
  const automaticItem = feedAutomatic.find((item) =>
    item.mpn === SEARCH_FIXTURE.analogArticle);

  assert.ok(publicAutomatic?.offer);
  assert.ok(automaticItem);
  assert.equal(publicAutomatic.offer.price, 523.45);
  assert.equal(automaticItem.price, `${publicAutomatic.offer.price.toFixed(2)} UAH`);
});


test("batch feed data classifies real parts and a real Collection shirt", async () => {
  const expected = new Map([
    ["A0024668801", GOOGLE_PRODUCT_CATEGORY.vehiclePartsAndAccessories],
    ["A6540900070", GOOGLE_PRODUCT_CATEGORY.vehiclePartsAndAccessories],
    ["B66959811", GOOGLE_PRODUCT_CATEGORY.shirtsAndTops],
  ]);
  const products = await pool.query(`
    SELECT id, article
    FROM products
    WHERE article = ANY($1::text[])
    ORDER BY article
  `, [[...expected.keys()]]);

  assert.equal(products.rows.length, expected.size);

  const rows = await GoogleMerchantFeedRepository.findCandidates(
    pool,
    { productIds: products.rows.map((product) => product.id) }
  );

  for (const product of products.rows) {
    const row = rows.find((candidate) =>
      Number(candidate.merchant_product_id) === Number(product.id));
    assert.ok(row, `Feed candidate ${product.article} not found`);
    assert.equal(
      googleProductCategoryFor(row),
      expected.get(product.article)
    );
  }
});
