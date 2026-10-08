import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/config/db.js";
import { EffectiveProductCategoryService } from "../src/services/EffectiveProductCategoryService.js";
import { LegacyCatalogRedirectService, LEGACY_CATALOG_REDIRECTS } from "../src/services/LegacyCatalogRedirectService.js";
import { PublicSeoService } from "../src/services/PublicSeoService.js";

const originalFlag = process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
after(async () => {
  if (originalFlag === undefined) delete process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
  else process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = originalFlag;
  await pool.end();
});

test("public category follows the active taxonomy without changing technical EPC or memberships", async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    const article = `SEO${Date.now()}`;
    const { rows: [product] } = await db.query(`INSERT INTO products(article, article_normalized, name)
      VALUES($1, $1, 'SEO fixture') RETURNING id`, [article]);
    const { rows: [category] } = await db.query("SELECT id FROM customer_categories WHERE slug = 'body-windshields'");
    process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "true";
    assert.equal(await EffectiveProductCategoryService.getPublicByProductId(product.id, db), null);
    await db.query(`INSERT INTO product_customer_categories(product_id, customer_category_id,
      assignment_source, assignment_origin, confidence, approval_status, is_primary)
      VALUES($1, $2, 'MANUAL', 'ADMIN', 'LOW', 'REVIEW', FALSE)`, [product.id, category.id]);
    assert.equal(await EffectiveProductCategoryService.getPublicByProductId(product.id, db), null);
    await db.query(`UPDATE product_customer_categories SET confidence = 'HIGH', approval_status = 'MANUAL_APPROVED',
      approved_at = NOW(), is_primary = TRUE WHERE product_id = $1`, [product.id]);
    const before = await db.query("SELECT * FROM product_customer_categories WHERE product_id = $1", [product.id]);
    const technicalBefore = await EffectiveProductCategoryService.getByProductId(product.id, db);
    const customer = await EffectiveProductCategoryService.getPublicByProductId(product.id, db);
    assert.equal(customer.slug, "body-windshields");
    assert.equal(customer.parent_slug, "body-glass");
    for (const locale of ["uk", "ru", "en"]) assert.ok(customer[`name_${locale}`]);
    process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "false";
    assert.deepEqual(await EffectiveProductCategoryService.getPublicByProductId(product.id, db), technicalBefore);
    process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "true";
    await db.query("UPDATE customer_categories SET is_navigation_visible = FALSE, is_active = FALSE WHERE id = $1", [category.id]);
    assert.equal(await EffectiveProductCategoryService.getPublicByProductId(product.id, db), null);
    assert.deepEqual((await db.query("SELECT * FROM product_customer_categories WHERE product_id = $1", [product.id])).rows, before.rows);
    assert.deepEqual(await EffectiveProductCategoryService.getByProductId(product.id, db), technicalBefore);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("only reviewed legacy systems redirect; flag off and mixed groups do not query targets", async () => {
  const noQuery = { query: () => assert.fail("Unreviewed or disabled redirects must not query") };
  process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "false";
  assert.equal(await LegacyCatalogRedirectService.resolve("mb-group-42", noQuery), null);
  process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "true";
  for (const slug of ["mb-group-67", "mb-group-18", "mb-group-99", "other", "toString"]) {
    assert.equal(await LegacyCatalogRedirectService.resolve(slug, noQuery), null);
  }
  for (const [slug, target] of Object.entries(LEGACY_CATALOG_REDIRECTS)) {
    assert.deepEqual(await LegacyCatalogRedirectService.resolve(slug), { slug: target, status: 301 });
  }
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    await db.query("UPDATE customer_categories SET is_navigation_visible = FALSE, is_active = FALSE WHERE slug = 'brakes'");
    assert.equal(await LegacyCatalogRedirectService.resolve("mb-group-42", db), null);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("sitemap eligibility matches product robots for prices, stock and reservation changes", async () => {
  const suffix = String(Date.now());
  const article = `SEOCOMMERCE${suffix}`;
  let productId, offerId, warehouseId, cartId;
  try {
    warehouseId = (await pool.query("INSERT INTO warehouses(name, city, type) VALUES($1, 'Kyiv', 'OWN') RETURNING id", [`SEO ${suffix}`])).rows[0].id;
    productId = (await pool.query("INSERT INTO products(article, article_normalized, name, is_active) VALUES($1, $1, 'SEO fixture', TRUE) RETURNING id", [article])).rows[0].id;
    offerId = (await pool.query(`INSERT INTO product_offers(product_id, warehouse_id, quantity, purchase_price,
      retail_price, minimum_sale_price, delivery_days, is_available, source_type, price_mode, is_hidden)
      VALUES($1, $2, 1, 80, 120, 100, 0, TRUE, 'OWN_STOCK', 'AUTO', FALSE) RETURNING id`, [productId, warehouseId])).rows[0].id;
    async function check(expected, label) {
      const sitemap = await PublicSeoService.getSitemap();
      const product = await PublicSeoService.getProduct({ article, locale: "uk" });
      assert.equal(product.offer?.isAvailable === true, expected, `${label}: product robots input`);
      assert.equal(sitemap.products.find(row => row.article === article)?.isAvailable, expected, `${label}: sitemap`);
    }
    await check(true, "available without photo");
    for (const price of [0, -1, null]) {
      await pool.query("UPDATE product_offers SET retail_price = $1 WHERE id = $2", [price, offerId]);
      await check(false, `price ${price}`);
    }
    await pool.query("UPDATE product_offers SET price_mode = 'MANUAL', manual_retail_price = 150 WHERE id = $1", [offerId]);
    await check(true, "valid manual price overrides null retail");
    await pool.query("UPDATE product_offers SET is_hidden = TRUE WHERE id = $1", [offerId]);
    await check(false, "hidden");
    await pool.query("UPDATE product_offers SET is_hidden = FALSE, quantity = 0 WHERE id = $1", [offerId]);
    await check(false, "empty stock");
    await pool.query("UPDATE product_offers SET quantity = 1 WHERE id = $1", [offerId]);
    cartId = (await pool.query("INSERT INTO carts DEFAULT VALUES RETURNING id")).rows[0].id;
    await pool.query(`INSERT INTO stock_reservations(cart_id, product_offer_id, quantity, status, reserved_until)
      VALUES($1, $2, 1, 'ACTIVE', NOW() + INTERVAL '10 minutes')`, [cartId, offerId]);
    await check(false, "fully reserved");
    await pool.query("UPDATE stock_reservations SET reserved_until = NOW() - INTERVAL '1 minute' WHERE cart_id = $1", [cartId]);
    await check(true, "expired reservation");
    await pool.query("UPDATE stock_reservations SET status = 'ORDER_PENDING' WHERE cart_id = $1", [cartId]);
    await check(false, "order pending still holds stock");
    await pool.query("DELETE FROM stock_reservations WHERE cart_id = $1", [cartId]);
    await pool.query("UPDATE warehouses SET is_active = FALSE WHERE id = $1", [warehouseId]);
    await check(false, "inactive warehouse");
  } finally {
    if (cartId) {
      await pool.query("DELETE FROM stock_reservations WHERE cart_id = $1", [cartId]);
      await pool.query("DELETE FROM carts WHERE id = $1", [cartId]);
    }
    if (offerId) await pool.query("DELETE FROM product_offers WHERE id = $1", [offerId]);
    if (productId) await pool.query("DELETE FROM products WHERE id = $1", [productId]);
    if (warehouseId) await pool.query("DELETE FROM warehouses WHERE id = $1", [warehouseId]);
  }
});
