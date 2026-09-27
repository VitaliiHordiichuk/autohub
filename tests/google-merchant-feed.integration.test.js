import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { GoogleMerchantFeedService } from "../src/services/GoogleMerchantFeedService.js";
import { GoogleMerchantFeedRepository } from "../src/repositories/GoogleMerchantFeedRepository.js";
import { ProductRepository } from "../src/repositories/ProductRepository.js";
import {
  GOOGLE_PRODUCT_CATEGORY,
  googleProductCategoryFor,
} from "../src/services/GoogleProductCategoryService.js";
import { PublicSeoService } from "../src/services/PublicSeoService.js";
import { CustomerPricingService } from "../src/services/CustomerPricingService.js";
import { OfferService } from "../src/services/OfferService.js";
import { PublicSearchPresenterService } from "../src/services/PublicSearchPresenterService.js";
import { SEARCH_FIXTURE } from "./helpers/search-fixture.js";


const imageRevision = Date.now();
const testSiteImageUrl =
  `https://images.example.test/processed/site-${imageRevision}.webp`;
const testOriginalImageUrl =
  `https://images.example.test/originals/original-${imageRevision}.jpg`;
const testMerchantImageUrl =
  `https://images.example.test/merchant/clean-${imageRevision}-1500.webp`;
let productId;
let offerId;
let originalOffer;


async function guestStorefrontOffers() {
  const product = await ProductRepository.findByNormalizedArticle(
    SEARCH_FIXTURE.analogNormalized
  );
  const guestContext = await CustomerPricingService.getContext(null, pool);
  const offers = await OfferService.getOffersByProductId(
    product.id,
    guestContext,
    "uk"
  );
  const presented = await PublicSearchPresenterService.present({
    requestedLocale: "uk",
    family: [],
    productCard: {
      product,
      offers,
      analogs: [],
      replacements: [],
    },
  });

  return presented.productCard.offers;
}


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
    INSERT INTO product_images(
      product_id, url, source, priority, original_url,
      processed_url_1600, merchant_url_1500, processing_status, display_mode
    )
    VALUES ($1, $2, 'TEST', -1000, $3, $2, $4, 'PROCESSED', 'PROCESSED')
  `, [productId, testSiteImageUrl, testOriginalImageUrl, testMerchantImageUrl]);
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
      [productId, testSiteImageUrl]
    );
  }
  await pool.end();
});


test("feed uses the clean Merchant image and falls back only to the original", async () => {
  const merchantItems = await GoogleMerchantFeedService.getItems(
    pool,
    { productIds: [productId] }
  );
  const merchantItem = merchantItems.find((item) =>
    item.mpn === SEARCH_FIXTURE.analogArticle);

  assert.ok(merchantItem);
  assert.equal(merchantItem.imageLink, testMerchantImageUrl);
  assert.notEqual(merchantItem.imageLink, testSiteImageUrl);

  await pool.query(`
    UPDATE product_images
    SET merchant_url_1500 = NULL
    WHERE product_id = $1 AND url = $2
  `, [productId, testSiteImageUrl]);

  try {
    const fallbackItems = await GoogleMerchantFeedService.getItems(
      pool,
      { productIds: [productId] }
    );
    const fallbackItem = fallbackItems.find((item) =>
      item.mpn === SEARCH_FIXTURE.analogArticle);

    assert.ok(fallbackItem);
    assert.equal(fallbackItem.imageLink, testOriginalImageUrl);
    assert.notEqual(fallbackItem.imageLink, testSiteImageUrl);
  } finally {
    await pool.query(`
      UPDATE product_images
      SET merchant_url_1500 = $3
      WHERE product_id = $1 AND url = $2
    `, [productId, testSiteImageUrl, testMerchantImageUrl]);
  }
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
  const storefrontManual = await guestStorefrontOffers();
  const feedManual = await GoogleMerchantFeedService.getItems(
    pool,
    { productIds: [productId] }
  );
  const manualItem = feedManual.find((item) =>
    item.mpn === SEARCH_FIXTURE.analogArticle);

  assert.ok(publicManual?.offer);
  assert.ok(manualItem);
  assert.equal(storefrontManual[0].retailPrice, 551.23);
  assert.equal(publicManual.offer.price, 551.23);
  assert.equal(publicManual.offer.price, storefrontManual[0].retailPrice);
  assert.equal(manualItem.price, `${storefrontManual[0].retailPrice.toFixed(2)} UAH`);

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
  const storefrontAutomatic = await guestStorefrontOffers();
  const feedAutomatic = await GoogleMerchantFeedService.getItems(
    pool,
    { productIds: [productId] }
  );
  const automaticItem = feedAutomatic.find((item) =>
    item.mpn === SEARCH_FIXTURE.analogArticle);

  assert.ok(publicAutomatic?.offer);
  assert.ok(automaticItem);
  assert.equal(storefrontAutomatic[0].retailPrice, 523.45);
  assert.equal(publicAutomatic.offer.price, 523.45);
  assert.equal(publicAutomatic.offer.price, storefrontAutomatic[0].retailPrice);
  assert.equal(automaticItem.price, `${storefrontAutomatic[0].retailPrice.toFixed(2)} UAH`);
});


test("multiple offers keep the same guest primary offer in storefront, SEO and Merchant", async () => {
  const supplierName = `D11 PARTNER ${Date.now()}`;
  const supplierResult = await pool.query(`
    INSERT INTO suppliers(name, type, is_active)
    VALUES($1, 'PARTNER', TRUE)
    RETURNING id
  `, [supplierName]);
  const supplierId = Number(supplierResult.rows[0].id);
  let partnerOfferId = null;

  try {
    const primaryOfferResult = await pool.query(`
      SELECT CASE
        WHEN price_mode = 'MANUAL' AND manual_retail_price IS NOT NULL
        THEN manual_retail_price
        ELSE retail_price
      END AS public_price
      FROM product_offers
      WHERE id = $1
    `, [offerId]);
    const primaryPrice = Number(primaryOfferResult.rows[0].public_price);
    const partnerResult = await pool.query(`
      INSERT INTO product_offers(
        product_id, warehouse_id, supplier_id, quantity,
        purchase_price, retail_price, minimum_sale_price,
        delivery_days, is_available, source_type,
        price_mode, manual_retail_price, is_hidden
      )
      VALUES($1, NULL, $2, 3, 100, $3, 100, 2, TRUE,
        'SUPPLIER', 'AUTO', NULL, FALSE)
      RETURNING id
    `, [productId, supplierId, primaryPrice - 50]);
    partnerOfferId = Number(partnerResult.rows[0].id);

    const storefrontOffers = await guestStorefrontOffers();
    const publicProduct = await PublicSeoService.getProduct({
      article: SEARCH_FIXTURE.analogArticle,
      locale: "uk",
    }, pool);
    const merchantItem = (await GoogleMerchantFeedService.getItems(
      pool,
      { productIds: [productId] }
    )).find((item) => item.mpn === SEARCH_FIXTURE.analogArticle);

    assert.equal(storefrontOffers[0].id, offerId);
    assert.equal(storefrontOffers[1].id, partnerOfferId);
    assert.ok(storefrontOffers[1].retailPrice < storefrontOffers[0].retailPrice);
    assert.equal(publicProduct.offer.id, storefrontOffers[0].id);
    assert.equal(publicProduct.offer.price, storefrontOffers[0].retailPrice);
    assert.equal(publicProduct.offer.isAvailable, true);
    assert.equal(merchantItem.price, `${storefrontOffers[0].retailPrice.toFixed(2)} UAH`);
    assert.equal(merchantItem.availability, "in_stock");
  } finally {
    if (partnerOfferId) {
      await pool.query("DELETE FROM product_offers WHERE id = $1", [partnerOfferId]);
    }
    await pool.query("DELETE FROM suppliers WHERE id = $1", [supplierId]);
  }
});


test("invalid public offers create neither an SEO offer nor a Merchant item", async () => {
  const currentResult = await pool.query(`
    SELECT quantity, retail_price, minimum_sale_price, price_mode,
      manual_retail_price, is_available, is_hidden
    FROM product_offers
    WHERE id = $1
  `, [offerId]);
  const current = currentResult.rows[0];
  const cases = [
    { name: "hidden", set: "is_hidden = TRUE" },
    { name: "unavailable", set: "is_available = FALSE" },
    { name: "zero quantity", set: "quantity = 0" },
    {
      name: "zero public price",
      set: "price_mode = 'AUTO', retail_price = 0, manual_retail_price = NULL",
    },
  ];

  try {
    for (const scenario of cases) {
      await pool.query(`
        UPDATE product_offers
        SET quantity = 4,
            retail_price = 523.45,
            minimum_sale_price = 400,
            price_mode = 'AUTO',
            manual_retail_price = NULL,
            is_available = TRUE,
            is_hidden = FALSE
        WHERE id = $1
      `, [offerId]);
      await pool.query(`
        UPDATE product_offers
        SET ${scenario.set}
        WHERE id = $1
      `, [offerId]);

      const publicProduct = await PublicSeoService.getProduct({
        article: SEARCH_FIXTURE.analogArticle,
        locale: "uk",
      }, pool);
      const merchantItems = await GoogleMerchantFeedService.getItems(
        pool,
        { productIds: [productId] }
      );
      const storefrontOffers = await guestStorefrontOffers();

      assert.equal(storefrontOffers.length, 0, scenario.name);
      assert.equal(publicProduct.offer, null, scenario.name);
      assert.equal(publicProduct.offers.length, 0, scenario.name);
      assert.equal(
        merchantItems.some((item) => item.mpn === SEARCH_FIXTURE.analogArticle),
        false,
        scenario.name
      );
    }
  } finally {
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
      current.quantity,
      current.retail_price,
      current.minimum_sale_price,
      current.price_mode,
      current.manual_retail_price,
      current.is_available,
      current.is_hidden,
    ]);
  }
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
