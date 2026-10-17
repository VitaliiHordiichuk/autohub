import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { PublicCatalogService } from "../src/services/PublicCatalogService.js";
import { PublicSeoService } from "../src/services/PublicSeoService.js";

const originalPublicTaxonomyFlag = process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
let legacyOnlySlug;

function setPublicTaxonomyFlag(value) {
  if (value === undefined) {
    delete process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
  } else {
    process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = value;
  }
}

function flattenSlugs(categories, { customerTaxonomy = false } = {}) {
  return categories.flatMap((category) => (
    customerTaxonomy
      && (category.isVirtual || Number(category.productCount) <= 0)
  ) ? [] : [
    category.slug,
    ...flattenSlugs(category.children || [], { customerTaxonomy }),
  ]);
}

before(async () => {
  // Legacy sitemap includes only visible categories with active products,
  // not every active DB category. Choose the fixture from the public tree.
  setPublicTaxonomyFlag("false");
  const visibleLegacySlugs = flattenSlugs(await PublicCatalogService.getTree("uk"));
  const activeCustomerCategories = await pool.query(`
    SELECT slug FROM customer_categories
    WHERE status = 'ACTIVE' AND is_active = TRUE
  `);
  const activeCustomerSlugs = new Set(activeCustomerCategories.rows.map((row) => row.slug));
  legacyOnlySlug = visibleLegacySlugs.find((slug) => !activeCustomerSlugs.has(slug));
  assert.ok(legacyOnlySlug, "A visible legacy-only category fixture is required");
});

after(async () => {
  setPublicTaxonomyFlag(originalPublicTaxonomyFlag);
  await pool.end();
});

test("missing public taxonomy flag preserves legacy EPC catalog", async () => {
  setPublicTaxonomyFlag(undefined);
  const tree = await PublicCatalogService.getTree("uk");

  assert.ok(tree.length > 0);
  assert.equal(tree.some((category) => category.isVirtual === true), false);
  assert.equal(tree.some((category) => category.slug === "filters-maintenance"), false);
});

test("explicit false public taxonomy flag preserves legacy EPC catalog", async () => {
  for (const value of ["false", "0", "no", "off"]) {
    setPublicTaxonomyFlag(value);
    const tree = await PublicCatalogService.getTree("ru");
    assert.equal(tree.some((category) => category.isVirtual === true), false, value);
    assert.equal(tree.some((category) => category.slug === "filters-maintenance"), false, value);
  }
});

test("explicit true public taxonomy flag exposes customer roots and virtual Other last", async () => {
  for (const value of ["true", "1", "yes", "on"]) {
    setPublicTaxonomyFlag(value);
    const tree = await PublicCatalogService.getTree("en");
    const realRoots = tree.slice(0, -1);

    assert.equal(realRoots.length, 16, value);
    assert.equal(realRoots[0]?.slug, "filters-maintenance", value);
    assert.equal(tree.at(-1)?.slug, "other", value);
    assert.equal(tree.at(-1)?.name, "Other", value);
    assert.equal(tree.at(-1)?.isVirtual, true, value);
  }
});

test("legacy category routes resolve only while the public taxonomy flag is off", async () => {
  setPublicTaxonomyFlag("false");
  const legacy = await PublicCatalogService.getCategoryProducts({
    slug: legacyOnlySlug,
    locale: "uk",
  });
  assert.equal(legacy?.category.slug, legacyOnlySlug);
  assert.equal(Object.hasOwn(legacy.category, "isVirtual"), false);

  setPublicTaxonomyFlag("true");
  assert.equal(await PublicCatalogService.getCategoryProducts({
    slug: legacyOnlySlug,
    locale: "uk",
  }), null);
});

test("category sitemap switches together with the public catalog flag", async () => {
  setPublicTaxonomyFlag("false");
  const legacyTree = await PublicCatalogService.getTree("uk");
  const legacySitemap = await PublicSeoService.getSitemap();
  assert.deepEqual(
    legacySitemap.categories.map((category) => category.slug),
    flattenSlugs(legacyTree),
  );
  assert.ok(legacySitemap.categories.some(
    (category) => category.slug === legacyOnlySlug,
  ));

  setPublicTaxonomyFlag("true");
  const customerTree = await PublicCatalogService.getTree("uk");
  const customerSitemap = await PublicSeoService.getSitemap();
  const customerSlugs = customerSitemap.categories.map((category) => category.slug);
  assert.deepEqual(
    customerSlugs,
    flattenSlugs(customerTree, { customerTaxonomy: true }),
  );
  assert.equal(customerSlugs.includes("other"), false);
  assert.equal(customerSlugs.includes(legacyOnlySlug), false);
});
