import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { PublicCatalogService } from "../src/services/PublicCatalogService.js";
import { PublicSeoService } from "../src/services/PublicSeoService.js";

const originalPublicTaxonomyFlag = process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "true";

const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`.toUpperCase();
const fixtures = {};
let brakesId;
let brakesDiscsId;

async function insertProduct(key, { active = true } = {}) {
  const article = `CT${key.toUpperCase()}${suffix}`;
  const result = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, $2, $3)
    RETURNING id
  `, [article, `Customer taxonomy ${key} ${suffix}`, active]);
  fixtures[key] = { id: Number(result.rows[0].id), article };
  return fixtures[key];
}

async function insertApprovedPrimary(productId, categoryId) {
  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id,
      customer_category_id,
      is_primary,
      assignment_source,
      assignment_origin,
      confidence,
      approval_status,
      approved_at
    )
    VALUES($1, $2, TRUE, 'MANUAL', 'ADMIN', 'HIGH', 'MANUAL_APPROVED', NOW())
  `, [productId, categoryId]);
}

before(async () => {
  const categories = await pool.query(`
    SELECT id, slug
    FROM customer_categories
    WHERE slug IN ('brakes', 'brakes-discs')
  `);
  brakesId = Number(categories.rows.find((row) => row.slug === "brakes")?.id);
  brakesDiscsId = Number(categories.rows.find((row) => row.slug === "brakes-discs")?.id);
  assert.ok(brakesId);
  assert.ok(brakesDiscsId);

  const unresolved = await insertProduct("unresolved");
  const reviewed = await insertProduct("reviewed");
  const approved = await insertProduct("approved");
  await insertProduct("inactive", { active: false });
  for (let index = 0; index < 25; index += 1) {
    await insertProduct(`page${index}`);
  }

  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id,
      customer_category_id,
      is_primary,
      assignment_source,
      assignment_origin,
      confidence,
      approval_status
    )
    VALUES($1, $2, FALSE, 'MANUAL', 'MIGRATION', 'LOW', 'REVIEW')
  `, [reviewed.id, brakesId]);
  await insertApprovedPrimary(approved.id, brakesDiscsId);

  assert.ok(unresolved.id);
});

after(async () => {
  const productIds = Object.values(fixtures).map((fixture) => fixture.id);
  if (productIds.length) {
    await pool.query(
      "DELETE FROM product_customer_categories WHERE product_id = ANY($1::integer[])",
      [productIds],
    );
    await pool.query(
      "DELETE FROM product_categories WHERE product_id = ANY($1::integer[])",
      [productIds],
    );
    await pool.query(
      "DELETE FROM products WHERE id = ANY($1::integer[])",
      [productIds],
    );
  }
  if (originalPublicTaxonomyFlag === undefined) {
    delete process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
  } else {
    process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = originalPublicTaxonomyFlag;
  }
  await pool.end();
});

test("public tree exposes the 16 real customer roots and appends localized virtual Other", async () => {
  const expectedRoots = await pool.query(`
    SELECT slug
    FROM customer_categories
    WHERE parent_id IS NULL
      AND status = 'ACTIVE'
      AND is_active = TRUE
    ORDER BY sort_order, id
  `);
  assert.equal(expectedRoots.rowCount, 16);

  for (const [locale, label] of [["uk", "Інше"], ["ru", "Остальное"], ["en", "Other"]]) {
    const tree = await PublicCatalogService.getTree(locale);
    assert.deepEqual(
      tree.slice(0, -1).map((category) => category.slug),
      expectedRoots.rows.map((category) => category.slug),
    );
    assert.deepEqual(tree.at(-1), {
      id: 0,
      parentId: null,
      slug: "other",
      name: label,
      directProductCount: tree.at(-1).productCount,
      productCount: tree.at(-1).productCount,
      isVirtual: true,
      children: [],
    });
  }
});

test("Other count is dynamic and uses only active products without an approved primary", async () => {
  const expected = await pool.query(`
    SELECT COUNT(*)::integer AS count
    FROM products product
    WHERE product.is_active = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM product_customer_categories membership
        WHERE membership.product_id = product.id
          AND membership.is_primary = TRUE
          AND membership.approval_status IN ('AUTO_APPROVED', 'MANUAL_APPROVED')
      )
  `);
  const tree = await PublicCatalogService.getTree("uk");
  assert.equal(tree.at(-1).slug, "other");
  assert.equal(tree.at(-1).productCount, Number(expected.rows[0].count));

  const unresolved = await PublicCatalogService.getCategoryProducts({
    slug: "other",
    locale: "uk",
    query: fixtures.unresolved.article,
  });
  const reviewed = await PublicCatalogService.getCategoryProducts({
    slug: "other",
    locale: "uk",
    query: fixtures.reviewed.article,
  });
  const approved = await PublicCatalogService.getCategoryProducts({
    slug: "other",
    locale: "uk",
    query: fixtures.approved.article,
  });
  const inactive = await PublicCatalogService.getCategoryProducts({
    slug: "other",
    locale: "uk",
    query: fixtures.inactive.article,
  });

  assert.deepEqual(unresolved.products.map((product) => Number(product.id)), [fixtures.unresolved.id]);
  assert.deepEqual(reviewed.products.map((product) => Number(product.id)), [fixtures.reviewed.id]);
  assert.equal(approved.pagination.total, 0);
  assert.equal(inactive.pagination.total, 0);
});

test("Other supports normal pagination and automatically loses newly approved products", async () => {
  const paginatedFirst = await PublicCatalogService.getCategoryProducts({
    slug: "other",
    locale: "en",
    query: "CTPAGE",
    page: 1,
  });
  const paginatedSecond = await PublicCatalogService.getCategoryProducts({
    slug: "other",
    locale: "en",
    query: "CTPAGE",
    page: 2,
  });
  assert.equal(paginatedFirst.pagination.total, 25);
  assert.equal(paginatedFirst.pagination.pages, 2);
  assert.equal(paginatedFirst.products.length, 24);
  assert.equal(paginatedSecond.pagination.page, 2);
  assert.equal(paginatedSecond.products.length, 1);

  const before = await PublicCatalogService.getCategoryProducts({
    slug: "other",
    locale: "ru",
    query: fixtures.unresolved.article,
    page: 1,
    sort: "name_asc",
  });
  assert.equal(before.category.name, "Остальное");
  assert.equal(before.category.isVirtual, true);
  assert.deepEqual(before.category.children, []);
  assert.equal(before.pagination.page, 1);
  assert.equal(before.pagination.pageSize, 24);
  assert.equal(before.pagination.total, 1);
  assert.equal(before.filters.sort, "name_asc");

  await insertApprovedPrimary(fixtures.unresolved.id, brakesDiscsId);

  const after = await PublicCatalogService.getCategoryProducts({
    slug: "other",
    locale: "ru",
    query: fixtures.unresolved.article,
  });
  const realCategory = await PublicCatalogService.getCategoryProducts({
    slug: "brakes",
    locale: "ru",
    query: fixtures.unresolved.article,
  });
  assert.equal(after.pagination.total, 0);
  assert.deepEqual(realCategory.products.map((product) => Number(product.id)), [fixtures.unresolved.id]);
});

test("sitemap publishes real customer categories and excludes virtual Other", async () => {
  const sitemap = await PublicSeoService.getSitemap();
  const categorySlugs = sitemap.categories.map((category) => category.slug);
  assert.ok(categorySlugs.includes("brakes"));
  assert.equal(categorySlugs.includes("other"), false);
});
