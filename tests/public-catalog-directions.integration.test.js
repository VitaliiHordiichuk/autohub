import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { PublicCatalogService } from "../src/services/PublicCatalogService.js";

const previousFlag = process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "true";

after(async () => {
  if (previousFlag === undefined) delete process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
  else process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = previousFlag;
  await pool.end();
});

test("PostgreSQL merges roots before count, sorting, filtering and pagination without altering existing category listings", async () => {
  const db = await pool.connect();
  const marker = `DIRECTION${Date.now()}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
  await db.query("BEGIN");
  try {
    const categories = await db.query(`
      SELECT id, slug FROM customer_categories
      WHERE slug IN ('engine', 'cooling') AND status = 'ACTIVE' AND is_active = TRUE
    `);
    const engineId = Number(categories.rows.find((row) => row.slug === "engine")?.id);
    const coolingId = Number(categories.rows.find((row) => row.slug === "cooling")?.id);
    const child = await db.query(`
      SELECT id, slug FROM customer_categories
      WHERE parent_id = $1 AND status = 'ACTIVE' AND is_active = TRUE
      ORDER BY sort_order, id LIMIT 1
    `, [engineId]);
    assert.ok(engineId && coolingId && child.rows[0]);

    const createdProducts = [];
    for (let index = 0; index < 26; index += 1) {
      const article = `${marker}${String(index).padStart(2, "0")}`;
      const product = await db.query(`
        INSERT INTO products(article, article_normalized, name, is_active)
        VALUES($1, $1, $2, TRUE) RETURNING id
      `, [article, `${marker} product ${String(index).padStart(2, "0")}`]);
      createdProducts.push(Number(product.rows[0].id));
      const categoryId = index === 0 ? Number(child.rows[0].id) : index % 2 ? coolingId : engineId;
      await db.query(`
        INSERT INTO product_customer_categories(product_id, customer_category_id, is_primary,
          assignment_source, assignment_origin, confidence, approval_status, approved_at)
        VALUES($1, $2, TRUE, 'MANUAL', 'ADMIN', 'HIGH', 'MANUAL_APPROVED', NOW())
      `, [product.rows[0].id, categoryId]);
    }
    for (const [index, price] of [[0, 30], [1, 10], [2, 20]]) {
      await db.query(`
        INSERT INTO product_offers(product_id, quantity, purchase_price, retail_price,
          source_type, is_available, is_hidden)
        VALUES($1, 5, 5, $2, 'OWN_STOCK', TRUE, FALSE)
      `, [createdProducts[index], price]);
    }

    const options = { slug: "engine-systems", directionSlug: "engine-systems", query: marker, sort: "name_asc" };
    const first = await PublicCatalogService.getCategoryProducts({ ...options, page: 1 }, db);
    const second = await PublicCatalogService.getCategoryProducts({ ...options, page: 2 }, db);
    assert.equal(first.pagination.total, 26);
    assert.equal(first.products.length, 24);
    assert.equal(second.products.length, 2);
    const articles = [...first.products, ...second.products].map((product) => product.article);
    assert.equal(new Set(articles).size, 26);
    assert.deepEqual(articles, [...articles].sort());

    const priceSorted = await PublicCatalogService.getCategoryProducts({
      ...options, page: 1, sort: "price_asc", availability: "available",
    }, db);
    assert.equal(priceSorted.pagination.total, 3);
    assert.deepEqual(priceSorted.products.map((product) => product.article),
      [`${marker}01`, `${marker}02`, `${marker}00`]);

    const childOnly = await PublicCatalogService.getCategoryProducts({
      ...options, subgroupSlug: child.rows[0].slug,
    }, db);
    assert.equal(childOnly.pagination.total, 1);
    assert.equal(childOnly.products[0].article, `${marker}00`);

    const unavailable = await PublicCatalogService.getCategoryProducts({
      ...options, availability: "unavailable",
    }, db);
    const available = await PublicCatalogService.getCategoryProducts({
      ...options, availability: "available",
    }, db);
    assert.equal(unavailable.pagination.total, 23);
    assert.equal(available.pagination.total, 3);

    const oldRoute = await PublicCatalogService.getCategoryProducts({
      slug: "engine", query: marker,
    }, db);
    assert.equal(oldRoute.pagination.total, 13);
    assert.equal(oldRoute.category.isDirection, undefined);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
