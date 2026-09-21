import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGoogleMerchantItems,
  buildMerchantTitle,
  GoogleMerchantFeedService,
  isPublicMerchantImage,
  renderGoogleMerchantFeed,
} from "./GoogleMerchantFeedService.js";
import { presentOffers } from "./OfferService.js";


function candidate(overrides = {}) {
  return {
    merchant_product_id: 101,
    merchant_article: "HU718/5X",
    merchant_name: "Фільтр масляний",
    merchant_name_provider: "MANUAL",
    merchant_description: null,
    merchant_brand: "MANN-FILTER",
    merchant_product_type: null,
    merchant_categories: [{
      id: 13,
      slug: "filter-oil",
      name: "Масляные фильтры",
      name_uk: "Масляні фільтри",
      parent_slug: "filters",
      parent_name: "Фильтры",
      parent_name_uk: "Фільтри",
      assignment_source: "AUTO_RULE",
      confidence: 90,
    }],
    merchant_image_urls: [
      "https://images.example.test/products/101/main.webp",
    ],
    id: 501,
    product_id: 101,
    warehouse_id: 10,
    supplier_id: 20,
    effective_supplier_id: 20,
    quantity: 4,
    retail_price: 1380.96,
    minimum_sale_price: 1100,
    delivery_days: 1,
    source_type: "SUPPLIER",
    is_available: true,
    is_hidden: false,
    is_returnable: true,
    warehouse_name: "Test warehouse",
    warehouse_city: "Харків",
    warehouse_priority: null,
    warehouse_active: true,
    supplier_name: "Test supplier",
    supplier_type: "PARTNER",
    supplier_active: true,
    warehouse_priority_enabled: false,
    ...overrides,
  };
}


test("builds one stable Google item with the guest retail price", () => {
  const items = buildGoogleMerchantItems([candidate()]);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    id: "maka-101",
    title: "MANN-FILTER Фільтр масляний HU718/5X",
    description: "Фільтр масляний. Бренд: MANN-FILTER. Артикул: HU718/5X.",
    link: "https://maka.com.ua/uk/product/HU718%2F5X",
    imageLink: "https://images.example.test/products/101/main.webp",
    additionalImageLinks: [],
    availability: "in_stock",
    price: "1380.96 UAH",
    condition: "new",
    brand: "MANN-FILTER",
    mpn: "HU718/5X",
    googleProductCategory: "5613",
  });
});


test("loads the whole feed with one batch database query", async () => {
  const queries = [];
  const db = {
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      return { rows: [candidate()] };
    },
  };

  const items = await GoogleMerchantFeedService.getItems(db);

  assert.equal(items.length, 1);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM products p/);
  assert.match(queries[0].sql, /COALESCE\(pi\.merchant_url_1500, pi\.original_url\)/);
  assert.doesNotMatch(queries[0].sql, /pi\.processed_url_1600/);
  assert.doesNotMatch(queries[0].sql, /COALESCE\([^)]*pi\.url/);
  assert.deepEqual(queries[0].parameters, [null]);
});


test("uses the same offer presentation and customer pricing as the public site", () => {
  const row = candidate({ retail_price: 1000, minimum_sale_price: 700 });
  const context = { discountPercent: 5, isVip: false };
  const publicOffer = presentOffers([row], context, "uk")[0];
  const item = buildGoogleMerchantItems([row], context)[0];

  assert.equal(publicOffer.retailPrice, 950);
  assert.equal(item.price, `${publicOffer.retailPrice.toFixed(2)} UAH`);
});


test("does not duplicate a brand or article already present in the name", () => {
  assert.equal(
    buildMerchantTitle({
      brand: "Mercedes-Benz",
      name: "Mercedes Benz Фільтр A2711800109",
      article: "A2711800109",
    }),
    "Mercedes Benz Фільтр A2711800109"
  );
});


test("strips description HTML and normalizes whitespace", () => {
  const item = buildGoogleMerchantItems([
    candidate({
      merchant_description: "  Масляний <strong>фільтр</strong> &amp; ущільнення.  ",
    }),
  ])[0];

  assert.equal(item.description, "Масляний фільтр & ущільнення.");
});


test("renders valid RSS structure, namespace and required merchant elements", () => {
  const xml = renderGoogleMerchantFeed(
    buildGoogleMerchantItems([candidate()])
  );

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss xmlns:g="http:\/\/base\.google\.com\/ns\/1\.0" version="2\.0">/);
  assert.match(xml, /<channel>/);
  assert.match(xml, /<item>/);
  for (const element of [
    "id",
    "title",
    "description",
    "link",
    "image_link",
    "availability",
    "price",
    "condition",
    "brand",
    "mpn",
    "google_product_category",
  ]) {
    assert.match(xml, new RegExp(`<g:${element}>[^<]+<\\/g:${element}>`));
  }
  assert.doesNotMatch(xml, /<g:product_type>/);
  assert.doesNotMatch(xml, /undefined|null|NaN|\[object Object\]/);
});


test("XML-escapes ampersands, angle brackets, quotes and apostrophes", () => {
  const xml = renderGoogleMerchantFeed([{
    id: "maka-1",
    title: `Фільтр & олива < 5\" '`,
    description: `Опис & деталь < 5 > 2 "тест" 'ok'`,
    link: "https://maka.com.ua/uk/product/A&B",
    imageLink: "https://images.example.test/a.webp?x=1&y=2",
    additionalImageLinks: [],
    availability: "in_stock",
    price: "10.00 UAH",
    condition: "new",
    brand: "A&B",
    mpn: "A&B",
  }]);

  assert.match(xml, /Фільтр &amp; олива &lt; 5&quot; &apos;/);
  assert.match(xml, /Опис &amp; деталь &lt; 5 &gt; 2 &quot;тест&quot; &apos;ok&apos;/);
  assert.doesNotMatch(xml, /<g:title>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/);
});


test("excludes a product without a real public HTTPS image", () => {
  for (const image of [
    null,
    "http://images.example.test/a.webp",
    "https://localhost/a.webp",
    "https://127.0.0.1/a.webp",
    "https://maka.com.ua/api/products/HU7185X/placeholder",
    "data:image/png;base64,abc",
  ]) {
    assert.equal(buildGoogleMerchantItems([
      candidate({ merchant_image_urls: image ? [image] : [] }),
    ]).length, 0);
  }
});


test("recognizes only credential-free public HTTPS image URLs", () => {
  assert.equal(isPublicMerchantImage("https://images.example.test/a.webp"), true);
  assert.equal(isPublicMerchantImage("https://user:pass@images.example.test/a.webp"), false);
  assert.equal(isPublicMerchantImage("/internal/a.webp"), false);
});


test("excludes an offer with zero available quantity", () => {
  assert.equal(buildGoogleMerchantItems([
    candidate({ quantity: 0 }),
  ]).length, 0);
});


test("excludes a disabled offer", () => {
  assert.equal(buildGoogleMerchantItems([
    candidate({ is_available: false }),
  ]).length, 0);
});


test("excludes a hidden offer", () => {
  assert.equal(buildGoogleMerchantItems([
    candidate({ is_hidden: true }),
  ]).length, 0);
});


test("excludes offers with zero or negative retail prices", () => {
  for (const price of [0, -1, null, "not-a-number"]) {
    assert.equal(buildGoogleMerchantItems([
      candidate({ retail_price: price }),
    ]).length, 0);
  }
});


test("creates one item for several offers and selects the public lowest price", () => {
  const items = buildGoogleMerchantItems([
    candidate({ id: 501, retail_price: 1400 }),
    candidate({ id: 502, supplier_id: 21, effective_supplier_id: 21,
      supplier_name: "Second supplier", retail_price: 1250.5 }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].price, "1250.50 UAH");
});


test("excludes products without a brand or canonical article", () => {
  assert.equal(buildGoogleMerchantItems([
    candidate({ merchant_brand: "" }),
  ]).length, 0);
  assert.equal(buildGoogleMerchantItems([
    candidate({ merchant_article: "" }),
  ]).length, 0);
});


test("keeps an unknown category item without inventing a Google category", () => {
  const item = buildGoogleMerchantItems([
    candidate({
      merchant_categories: [{
        slug: "other",
        name_uk: "Інше",
        parent_slug: null,
      }],
    }),
  ])[0];
  const xml = renderGoogleMerchantFeed([item]);

  assert.ok(item);
  assert.equal(item.googleProductCategory, null);
  assert.equal("productType" in item, false);
  assert.doesNotMatch(xml, /<g:google_product_category>/);
  assert.doesNotMatch(xml, /<g:product_type>/);
  assert.match(xml, /<item>/);
});


test("keeps one main image and at most ten additional images", () => {
  const images = Array.from(
    { length: 14 },
    (_, index) => `https://images.example.test/${index}.webp`
  );
  const item = buildGoogleMerchantItems([
    candidate({ merchant_image_urls: images }),
  ])[0];

  assert.equal(item.imageLink, images[0]);
  assert.equal(item.additionalImageLinks.length, 10);
  assert.equal(item.additionalImageLinks.at(-1), images[10]);
});
