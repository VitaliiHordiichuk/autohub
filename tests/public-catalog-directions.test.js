import test from "node:test";
import assert from "node:assert/strict";

import { CATALOG_DIRECTIONS } from "../src/services/CatalogDirections.js";
import { PublicCatalogService } from "../src/services/PublicCatalogService.js";
import { OfferService } from "../src/services/OfferService.js";

const previousFlag = process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "true";

const categoryRows = CATALOG_DIRECTIONS.flatMap((direction, directionIndex) =>
  direction.roots.map((slug, rootIndex) => ({
    id: directionIndex * 10 + rootIndex + 1,
    parent_id: null,
    slug,
    name: slug,
    direct_product_count: 2,
    product_count: 2,
    unresolved_product_count: 0,
  })),
);
categoryRows.push({
  id: 999, parent_id: categoryRows.find((row) => row.slug === "engine").id,
  slug: "engine-test-subgroup", name: "Engine test subgroup",
  direct_product_count: 1, product_count: 1, unresolved_product_count: 0,
});

function mockDb(productRows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes("unresolved_product_count")) return { rows: categoryRows };
      if (sql.includes("COUNT(*) OVER()")) return { rows: productRows };
      if (sql.includes("SELECT COUNT(*)::integer AS count")) return { rows: [{ count: 0 }] };
      if (sql.includes("FROM customer_categories category") && sql.includes("WHERE category.slug")) {
        return { rows: [{ id: 11, parent_id: null, slug: parameters[0], name: "Legacy category" }] };
      }
      if (sql.includes("WITH RECURSIVE direct_children")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
    },
  };
}

test("all nine directions explicitly and uniquely cover the existing sixteen customer roots", async () => {
  assert.equal(CATALOG_DIRECTIONS.length, 9);
  const rootSlugs = CATALOG_DIRECTIONS.flatMap((direction) => direction.roots);
  assert.equal(rootSlugs.length, 16);
  assert.equal(new Set(rootSlugs).size, 16);
  const directions = await PublicCatalogService.getDirections("uk", mockDb());
  assert.equal(directions.length, 9);
  assert.deepEqual(directions.find((direction) => direction.slug === "engine-systems").rootSlugs,
    ["engine", "cooling", "fuel-system", "exhaust"]);
  assert.equal(directions.find((direction) => direction.slug === "engine-systems").productCount, 8);
});

test("multi-root direction is deduplicated in SQL before global sorting and pagination", async () => {
  const db = mockDb([{ id: 201, article: "A201", name: "Part", filtered_count: 30 }]);
  const originalOffers = OfferService.getOffersByProductIds;
  OfferService.getOffersByProductIds = async () => new Map();
  try {
    const page = await PublicCatalogService.getCategoryProducts({
      slug: "engine-systems", directionSlug: "engine-systems", locale: "uk",
      page: 2, sort: "price_asc", pricingContext: { discountPercent: 12 },
    }, db);
    const listing = db.calls.find((call) => call.sql.includes("COUNT(*) OVER()"));
    assert.deepEqual(listing.parameters[0], [11, 12, 13, 14]);
    assert.equal(listing.parameters[7], 12);
    assert.deepEqual(listing.parameters.slice(-2), [24, 24]);
    assert.match(listing.sql, /SELECT DISTINCT membership\.product_id/);
    assert.match(listing.sql, /ORDER BY filtered\.minimum_available_price ASC NULLS LAST/);
    assert.equal(page.pagination.total, 30);
    assert.equal(page.pagination.pages, 2);
    assert.equal(page.category.isDirection, true);
    assert.ok(page.category.children.some((child) => child.slug === "engine-test-subgroup"));
  } finally {
    OfferService.getOffersByProductIds = originalOffers;
  }
});

test("subgroup belongs to selected direction and restricts the shared scope", async () => {
  const db = mockDb();
  const page = await PublicCatalogService.getCategoryProducts({
    slug: "engine-systems", directionSlug: "engine-systems",
    subgroupSlug: "engine-test-subgroup",
  }, db);
  assert.equal(page.category.selectedSubgroup, "engine-test-subgroup");
  assert.deepEqual(db.calls.find((call) => call.sql.includes("COUNT(*) OVER()")).parameters[0], [999]);

  const rejected = await PublicCatalogService.getCategoryProducts({
    slug: "engine-systems", directionSlug: "engine-systems", subgroupSlug: "brakes",
  }, mockDb());
  assert.equal(rejected, null);
});

test("existing category endpoint retains single-category SQL and parameters", async () => {
  const db = mockDb();
  const page = await PublicCatalogService.getCategoryProducts({ slug: "brakes" }, db);
  const listing = db.calls.find((call) => call.sql.includes("COUNT(*) OVER()"));
  assert.equal(page.category.isDirection, undefined);
  assert.equal(listing.parameters[0], 11);
  assert.match(listing.sql, /WHERE id = \$1\s+AND status = 'ACTIVE'/);
});

test.after(() => {
  if (previousFlag === undefined) delete process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
  else process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = previousFlag;
});
