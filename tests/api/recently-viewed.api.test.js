import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { app } from "../../src/app.js";
import { pool } from "../../src/config/db.js";
import { AuthService } from "../../src/services/AuthService.js";
import { SEARCH_FIXTURE } from "../helpers/search-fixture.js";

let server;
let baseUrl;
let firstAccount;
let secondAccount;
let localizedProduct;
let pricedOffer;
let generatedProducts = [];

function authCookie(account) {
  return `autohub_token=${account.token}`;
}

async function request(path, {
  account = null,
  method = "GET",
  body,
  expectedUserId = account?.user?.id,
  includeExpectedUserId = true,
  headers = {},
} = {}) {
  let requestPath = path;
  let requestBody = body;
  if (account && path.startsWith("/api/account/recently-viewed") && includeExpectedUserId) {
    if (method === "PUT") {
      requestBody = { ...body, expectedUserId };
    } else {
      const separator = path.includes("?") ? "&" : "?";
      requestPath = `${path}${separator}expectedUserId=${expectedUserId}`;
    }
  }
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: {
      ...(account ? { Cookie: authCookie(account) } : {}),
      ...(requestBody === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
  });
  return { response, data: await response.json() };
}

async function removeAccount(account) {
  const userId = Number(account?.user?.id);
  const customerId = Number(account?.customer?.id);
  if (customerId) {
    await pool.query("DELETE FROM customer_history WHERE customer_id=$1", [customerId]);
    await pool.query("DELETE FROM customers WHERE id=$1", [customerId]);
  }
  if (userId) {
    await pool.query("DELETE FROM user_delivery_profiles WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  firstAccount = await AuthService.register({
    firstName: "Recent",
    lastName: "First",
    phone: "+380671230001",
    email: `recent-first-${suffix}@autohub.local`,
    password: "RecentPassword42",
  });
  secondAccount = await AuthService.register({
    firstName: "Recent",
    lastName: "Second",
    phone: "+380671230002",
    email: `recent-second-${suffix}@autohub.local`,
    password: "RecentPassword42",
  });

  const fixtureProduct = (await pool.query(
    "SELECT id, brand_id FROM products WHERE article_normalized=$1 LIMIT 1",
    [SEARCH_FIXTURE.analogNormalized],
  )).rows[0];
  pricedOffer = (await pool.query(
    "SELECT id, manual_retail_price FROM product_offers WHERE product_id=$1 AND is_available=TRUE LIMIT 1",
    [fixtureProduct.id],
  )).rows[0];
  localizedProduct = (await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1,$2,$3,$4,TRUE)
    RETURNING id, article
  `, [fixtureProduct.brand_id, `RECENT-${suffix}`, `RECENT${suffix.replaceAll("-", "").toUpperCase()}`, "Recent default"])).rows[0];
  await pool.query(`
    INSERT INTO product_translations(product_id, language_code, name, provider)
    VALUES
      ($1,'en','Recent product EN','MANUAL'),
      ($1,'uk','Нещодавній товар','MANUAL'),
      ($1,'ru','Недавний товар','MANUAL')
    ON CONFLICT(product_id, language_code) DO UPDATE
    SET name=EXCLUDED.name, provider=EXCLUDED.provider
  `, [localizedProduct.id]);
  generatedProducts = (await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    SELECT $1,
      'RECENT-LIMIT-' || series || '-${suffix}',
      'RECENTLIMIT' || series || '${suffix.replaceAll("-", "").toUpperCase()}',
      'Recent limit ' || series,
      TRUE
    FROM generate_series(1,13) series
    RETURNING id, article
  `, [fixtureProduct.brand_id])).rows;
});

after(async () => {
  if (pricedOffer) {
    await pool.query("UPDATE product_offers SET manual_retail_price=$2 WHERE id=$1", [
      pricedOffer.id,
      pricedOffer.manual_retail_price,
    ]);
  }
  if (localizedProduct?.id) {
    await pool.query("DELETE FROM products WHERE id=$1", [localizedProduct.id]);
  }
  if (generatedProducts.length) {
    await pool.query("DELETE FROM products WHERE id=ANY($1::integer[])", [
      generatedProducts.map((product) => product.id),
    ]);
  }
  await removeAccount(firstAccount);
  await removeAccount(secondAccount);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("guest batch returns localized current product data without creating account history", async () => {
  const beforeCount = await pool.query("SELECT COUNT(*)::integer AS count FROM client_recently_viewed_products");
  const { response, data } = await request("/api/products/recently-viewed", {
    method: "POST",
    body: {
      locale: "en",
      items: [
        { article: localizedProduct.article, viewedAt: Date.now() },
        { article: "missing-product", viewedAt: Date.now() - 1 },
      ],
    },
  });
  assert.equal(response.status, 200);
  assert.equal(data.products.length, 1);
  assert.equal(data.products[0].name, "Recent product EN");
  assert.equal(data.products[0].price, null);
  assert.equal(data.products[0].availabilityStatus, "UNAVAILABLE");

  for (const [locale, expectedName] of [
    ["uk", "Нещодавній товар"],
    ["ru", "Недавний товар"],
  ]) {
    const localized = await request("/api/products/recently-viewed", {
      method: "POST",
      body: {
        locale,
        items: [{ article: localizedProduct.article, viewedAt: Date.now() }],
      },
    });
    assert.equal(localized.response.status, 200);
    assert.equal(localized.data.products[0].name, expectedName);
  }

  const count = await pool.query("SELECT count(*) FROM client_recently_viewed_products");
  assert.equal(Number(count.rows[0].count), beforeCount.rows[0].count);
});

test("account endpoints require a signed-in client", async () => {
  const { response } = await request("/api/account/recently-viewed?locale=uk");
  assert.equal(response.status, 401);
});

test("account endpoint requires the frontend account identity to match the session", async () => {
  const missing = await request("/api/account/recently-viewed?locale=uk", {
    account: secondAccount,
    includeExpectedUserId: false,
  });
  assert.equal(missing.response.status, 400);

  const mismatch = await request("/api/account/recently-viewed", {
    account: secondAccount,
    expectedUserId: firstAccount.user.id,
    method: "PUT",
    body: {
      locale: "uk",
      items: [{ article: localizedProduct.article, viewedAt: Date.now() }],
    },
  });
  assert.equal(mismatch.response.status, 409);
  const stored = await pool.query(
    "SELECT count(*) FROM client_recently_viewed_products WHERE user_id=$1 AND product_id=$2",
    [secondAccount.user.id, localizedProduct.id],
  );
  assert.equal(Number(stored.rows[0].count), 0);
});

test("merge deduplicates, orders repeat views and rehydrates current price", async () => {
  const now = Date.now();
  const merged = await request("/api/account/recently-viewed", {
    account: firstAccount,
    method: "PUT",
    body: {
      locale: "uk",
      items: [
        { article: SEARCH_FIXTURE.originalArticle, viewedAt: now - 2_000 },
        { article: SEARCH_FIXTURE.analogArticle, viewedAt: now },
        { article: SEARCH_FIXTURE.analogArticle.toLowerCase(), viewedAt: now - 1_000 },
      ],
    },
  });
  assert.equal(merged.response.status, 200);
  assert.deepEqual(merged.data.products.map((item) => item.article), [
    SEARCH_FIXTURE.analogArticle,
    SEARCH_FIXTURE.originalArticle,
  ]);

  await pool.query("UPDATE product_offers SET manual_retail_price=777 WHERE id=$1", [pricedOffer.id]);
  const refreshed = await request("/api/account/recently-viewed?locale=uk", {
    account: firstAccount,
  });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.data.products[0].price, 777);

  const repeated = await request("/api/account/recently-viewed", {
    account: firstAccount,
    method: "PUT",
    body: {
      locale: "uk",
      items: [{ article: SEARCH_FIXTURE.originalArticle, viewedAt: Date.now() }],
    },
  });
  assert.equal(repeated.data.products[0].article, SEARCH_FIXTURE.originalArticle);
  const stored = await pool.query(
    "SELECT count(*) FROM client_recently_viewed_products WHERE user_id=$1",
    [firstAccount.user.id],
  );
  assert.equal(Number(stored.rows[0].count), 2);
});

test("recently viewed uses the same current primary offer as the public product card", async () => {
  const product = await request(
    `/api/search/product?article=${encodeURIComponent(SEARCH_FIXTURE.analogArticle)}&locale=uk`,
  );
  const recent = await request("/api/products/recently-viewed", {
    method: "POST",
    body: {
      locale: "uk",
      items: [{ article: SEARCH_FIXTURE.analogArticle, viewedAt: Date.now() }],
    },
  });
  const primary = product.data.productCard.offers[0];
  assert.equal(recent.response.status, 200);
  assert.equal(recent.data.products[0].price, primary.retailPrice);
  assert.equal(recent.data.products[0].isAvailable, primary.isAvailable);
  assert.equal(recent.data.products[0].availabilityStatus, primary.availabilityStatus);
});

test("one client cannot read or write another client's history", async () => {
  const empty = await request("/api/account/recently-viewed?locale=en", {
    account: secondAccount,
  });
  assert.deepEqual(empty.data.products, []);

  const ownMerge = await request("/api/account/recently-viewed", {
    account: secondAccount,
    method: "PUT",
    body: {
      userId: firstAccount.user.id,
      locale: "en",
      items: [{ article: localizedProduct.article, viewedAt: Date.now() }],
    },
  });
  assert.equal(ownMerge.response.status, 200);
  assert.deepEqual(ownMerge.data.products.map((item) => item.article), [localizedProduct.article]);
  const firstCount = await pool.query(
    "SELECT count(*) FROM client_recently_viewed_products WHERE user_id=$1",
    [firstAccount.user.id],
  );
  assert.equal(Number(firstCount.rows[0].count), 2);
});

test("sequential views retain only the newest 12 products across devices", async () => {
  await request("/api/account/recently-viewed", {
    account: secondAccount,
    method: "DELETE",
  });
  const now = Date.now();
  const initial = await request("/api/account/recently-viewed", {
    account: secondAccount,
    method: "PUT",
    body: {
      locale: "uk",
      items: generatedProducts.slice(0, 12).map((product, index) => ({
        article: product.article,
        viewedAt: now - index - 1,
      })),
    },
  });
  assert.equal(initial.data.products.length, 12);

  await request("/api/account/recently-viewed", {
    account: secondAccount,
    method: "PUT",
    body: {
      locale: "uk",
      items: [{ article: generatedProducts[12].article, viewedAt: now }],
    },
  });
  const anotherDevice = await request("/api/account/recently-viewed?locale=uk", {
    account: secondAccount,
  });
  assert.equal(anotherDevice.data.products.length, 12);
  assert.equal(anotherDevice.data.products[0].article, generatedProducts[12].article);
  assert.equal(
    anotherDevice.data.products.some((item) => item.article === generatedProducts[11].article),
    false,
  );
});

test("two simultaneous device merges preserve both newest views and enforce the limit", async () => {
  await request("/api/account/recently-viewed", {
    account: secondAccount,
    method: "DELETE",
  });
  const now = Date.now();
  await request("/api/account/recently-viewed", {
    account: secondAccount,
    method: "PUT",
    body: {
      locale: "uk",
      items: generatedProducts.slice(0, 11).map((product, index) => ({
        article: product.article,
        viewedAt: now - 100 - index,
      })),
    },
  });

  const concurrent = await Promise.all([
    request("/api/account/recently-viewed", {
      account: secondAccount,
      method: "PUT",
      body: {
        locale: "uk",
        items: [{ article: generatedProducts[11].article, viewedAt: now }],
      },
    }),
    request("/api/account/recently-viewed", {
      account: secondAccount,
      method: "PUT",
      body: {
        locale: "uk",
        items: [{ article: generatedProducts[12].article, viewedAt: now + 1 }],
      },
    }),
  ]);
  assert.deepEqual(concurrent.map(({ response }) => response.status), [200, 200]);

  const merged = await request("/api/account/recently-viewed?locale=uk", {
    account: secondAccount,
  });
  const articles = merged.data.products.map((product) => product.article);
  assert.equal(articles.length, 12);
  assert.ok(articles.includes(generatedProducts[11].article));
  assert.ok(articles.includes(generatedProducts[12].article));
  assert.equal(articles.includes(generatedProducts[10].article), false);
  const stored = await pool.query(
    "SELECT count(*) FROM client_recently_viewed_products WHERE user_id=$1",
    [secondAccount.user.id],
  );
  assert.equal(Number(stored.rows[0].count), 12);
});

test("expired entries are ignored, oversized payloads are rejected and clear is account-scoped", async () => {
  await request("/api/account/recently-viewed", {
    account: secondAccount,
    method: "DELETE",
  });
  const expired = await request("/api/account/recently-viewed", {
    account: secondAccount,
    method: "PUT",
    body: {
      locale: "uk",
      items: [{
        article: localizedProduct.article,
        viewedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      }],
    },
  });
  assert.deepEqual(expired.data.products, []);

  const oversized = await request("/api/account/recently-viewed", {
    account: secondAccount,
    method: "PUT",
    body: {
      locale: "uk",
      items: Array.from({ length: 13 }, (_, index) => ({
        article: `TEST${index}`,
        viewedAt: Date.now() - index,
      })),
    },
  });
  assert.equal(oversized.response.status, 400);

  const cleared = await request("/api/account/recently-viewed", {
    account: firstAccount,
    method: "DELETE",
  });
  assert.equal(cleared.response.status, 200);
  const afterClear = await request("/api/account/recently-viewed?locale=uk", {
    account: firstAccount,
  });
  assert.deepEqual(afterClear.data.products, []);
});
