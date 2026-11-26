import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { PublicCatalogService } from "../src/services/PublicCatalogService.js";
import { CATALOG_DIRECTIONS, catalogDirection, buildCatalogNavigationGroups } from "../src/services/CatalogDirections.js";

const oldFlag = process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "true";
after(async () => {
  if (oldFlag === undefined) delete process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
  else process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = oldFlag;
  await pool.end();
});

function fixtureTree() {
  let nextId = 90;
  const leaf = (slug, productCount, children = []) => ({ id: nextId++, slug, name: slug, productCount, children });
  const engine = { id: 2, slug: "engine", name: "Двигун", productCount: 411, directProductCount: 60, children: [
    leaf("engine-gaskets-seals", 109), leaf("engine-mounts", 43), leaf("engine-belt-tensioners", 41),
    leaf("engine-covers-crankcase", 28), leaf("engine-valvetrain-components", 18), leaf("engine-timing-components", 17),
    leaf("engine-oil-system-components", 12), leaf("engine-intake-manifolds-throttle", 11), leaf("engine-intake-air-ducts", 10),
    leaf("engine-block-crankshaft-pistons", 9), leaf("engine-crankcase-ventilation", 9), leaf("engine-belt-rollers-idlers", 7),
    leaf("engine-cylinder-head-components", 6), leaf("engine-turbo-charge-air", 6), leaf("engine-vacuum-system", 6),
    leaf("engine-oil-lines-coolers", 4), leaf("engine-oil-pumps", 4), leaf("engine-air-filter-housings", 3),
    leaf("engine-belt-pulleys", 3), leaf("engine-sensors", 5),
  ] };
  const cooling = { id: 3, slug: "cooling", name: "Охолодження", productCount: 167, directProductCount: 85, children: [
    leaf("cooling-water-pumps", 20), leaf("cooling-thermostats", 18), leaf("cooling-radiators", 8),
    leaf("cooling-hoses-pipes", 12), leaf("cooling-expansion-tanks", 6), leaf("cooling-control-valves", 2),
    leaf("cooling-radiator-air-guides-mounts", 16),
  ] };
  const fuel = { id: 4, slug: "fuel-system", name: "Паливна система", productCount: 110, directProductCount: 59, children: [
    leaf("fuel-injectors", 5), leaf("fuel-pumps", 15), leaf("fuel-lines-hoses", 22), leaf("fuel-rails", 2),
    leaf("fuel-pressure-valves", 2), leaf("fuel-tanks-modules", 2), leaf("fuel-vapor-canisters", 3),
  ] };
  const exhaust = { id: 5, slug: "exhaust", name: "Вихлоп", productCount: 112, directProductCount: 26, children: [
    leaf("exhaust-catalysts", 2), leaf("exhaust-mufflers", 2), leaf("exhaust-pipes", 3), leaf("exhaust-egr", 1),
    leaf("exhaust-sensors", 38), leaf("exhaust-adblue-scr", 15), leaf("exhaust-mounts", 25),
  ] };
  const result = [engine, cooling, fuel, exhaust];
  for (const slug of new Set(CATALOG_DIRECTIONS.flatMap((item) => item.roots))) {
    if (!result.some((item) => item.slug === slug)) result.push(leaf(slug, 0));
  }
  return result;
}

async function withTree(run) {
  const original = PublicCatalogService.getTree;
  const roots = fixtureTree();
  PublicCatalogService.getTree = async () => roots;
  try { return await run(roots); } finally { PublicCatalogService.getTree = original; }
}

function categoryId(roots, slug) {
  const visit = (items) => {
    for (const item of items) {
      if (item.slug === slug) return item.id;
      const child = visit(item.children);
      if (child !== undefined) return child;
    }
  };
  return visit(roots);
}

test("engine navigation consolidates 45 legacy entries into the approved 12 groups without replacing them", async () => {
  await withTree(async (roots) => {
    const directions = await PublicCatalogService.getDirections("uk");
    const engine = directions.find((item) => item.slug === "engine-systems");
    assert.equal(engine.subgroups.length, 45);
    assert.equal(engine.navigationGroups.length, 12);
    assert.equal(engine.productCount, 800);
    assert.equal(engine.subgroups.find((item) => item.slug === "engine").productCount, 411);
    assert.deepEqual(engine.navigationGroups.map((item) => item.productCount), [43, 35, 51, 20, 30, 15, 109, 43, 5, 167, 110, 112]);
    assert.equal(engine.navigationGroups.reduce((count, group) => count + group.productCount, 0), 740);
    // The 60 direct engine products remain in the two existing all-product views.
    assert.equal(roots[0].directProductCount, 60);
    const drive = engine.navigationGroups.find((item) => item.slug === "engine-belt-drive");
    assert.deepEqual(drive.categoryIds, ["engine-belt-tensioners", "engine-belt-rollers-idlers", "engine-belt-pulleys"].map((slug) => categoryId(roots, slug)));
    assert.ok(drive.memberSlugs.includes("engine-belt-pulleys"));
    assert.ok(engine.subgroups.some((item) => item.slug === "engine-belt-pulleys" && item.productCount === 3));
    for (const item of directions.filter((item) => item.slug !== "engine-systems")) assert.equal(item.navigationGroups, undefined);
  });
});

test("cooling, fuel and exhaust groups contain their entire root including direct products", () => {
  const groups = buildCatalogNavigationGroups(catalogDirection("engine-systems"), fixtureTree(), "uk");
  for (const [slug, total, direct, child] of [
    ["cooling", 167, 85, "cooling-water-pumps"],
    ["fuel-system", 110, 59, "fuel-injectors"],
    ["exhaust", 112, 26, "exhaust-sensors"],
  ]) {
    const group = groups.find((item) => item.slug === slug);
    assert.equal(group.productCount, total);
    assert.ok(group.productCount > direct);
    assert.deepEqual(group.categorySlugs, [slug]);
    assert.ok(group.memberSlugs.includes(slug));
    assert.ok(group.memberSlugs.includes(child));
  }
});

test("duplicate sources and overlapping parent/child subtrees cannot inflate counts or IDs", () => {
  const leaf = { id: 3, slug: "leaf", productCount: 5, children: [] };
  const parent = { id: 2, slug: "parent", productCount: 12, children: [leaf] };
  const root = { id: 1, slug: "root", productCount: 20, children: [parent] };
  const definition = { navigationGroups: [{ slug: "merged", sources: ["leaf", "parent", "leaf", "parent"], names: { uk: "Разом" } }] };
  const [group] = buildCatalogNavigationGroups(definition, [root], "uk");
  assert.equal(group.productCount, 12);
  assert.deepEqual(group.categoryIds, [2]);
  assert.deepEqual(group.categorySlugs, ["parent"]);
  assert.deepEqual(group.memberSlugs, ["parent", "leaf"]);
});

test("empty or inactive sources omitted from the public tree do not break populated groups", () => {
  const roots = fixtureTree();
  roots[0].children = roots[0].children.filter((item) => !["engine-oil-pumps", "engine-oil-lines-coolers", "engine-turbo-charge-air"].includes(item.slug));
  const groups = buildCatalogNavigationGroups(catalogDirection("engine-systems"), roots, "uk");
  assert.equal(groups.find((item) => item.slug === "engine-oil-system").productCount, 12);
  assert.equal(groups.find((item) => item.slug === "engine-intake-boost").productCount, 24);
  const noSources = { navigationGroups: [{ slug: "absent", sources: ["not-public"], names: { uk: "Порожня" } }] };
  assert.deepEqual(buildCatalogNavigationGroups(noSources, roots, "uk"), []);
  assert.equal(buildCatalogNavigationGroups({ slug: "untouched" }, roots, "uk"), undefined);
});

test("navigation groups have Ukrainian, Russian and English labels and stable slugs", async () => {
  await withTree(async () => {
    for (const [locale, label] of [["uk", "Оливна система"], ["ru", "Масляная система"], ["en", "Oil system"]]) {
      const direction = (await PublicCatalogService.getDirections(locale)).find((item) => item.slug === "engine-systems");
      const group = direction.navigationGroups.find((item) => item.slug === "engine-oil-system");
      assert.equal(group.name, label);
      assert.equal(direction.navigationGroups.length, 12);
      assert.ok(direction.navigationGroups.every((item) => item.name && item.categoryIds.length));
    }
  });
});

test("merged listing uses all source IDs before the existing price, availability, sorting and pagination SQL", async () => {
  await withTree(async (roots) => {
    const calls = [];
    const db = { async query(sql, values) {
      calls.push({ sql, values });
      return { rows: /SELECT COUNT\(\*\)::integer AS count/.test(sql) ? [{ count: 26 }] : [] };
    } };
    const result = await PublicCatalogService.getCategoryProducts({
      slug: "engine-systems", directionSlug: "engine-systems", subgroupSlug: "engine-oil-system",
      locale: "ru", query: "  A  123 ", page: 2, availability: "available", minPrice: 200, maxPrice: 100,
      sort: "price_desc", pricingContext: { discountPercent: 15, isVip: false },
    }, db);
    assert.deepEqual(calls[0].values, [
      ["engine-oil-system-components", "engine-oil-lines-coolers", "engine-oil-pumps"].map((slug) => categoryId(roots, slug)),
      "ru", "A 123", "A123", "available", 100, 200, 15, false, 24, 24,
    ]);
    assert.match(calls[0].sql, /WHERE id = ANY\(\$1::integer\[\]\)/);
    assert.match(calls[0].sql, /SELECT DISTINCT membership\.product_id/);
    assert.match(calls[0].sql, /ORDER BY filtered\.minimum_available_price DESC NULLS LAST/);
    assert.match(calls[0].sql, /LIMIT \$10 OFFSET \$11/);
    assert.deepEqual(calls[1].values, calls[0].values.slice(0, 9));
    assert.equal(result.category.name, "Масляная система");
    assert.equal(result.category.selectedSubgroup, "engine-oil-system");
    assert.deepEqual(result.pagination, { page: 2, pageSize: 24, total: 26, pages: 2 });
    assert.deepEqual(result.filters, { query: "A 123", availability: "available", minPrice: 100, maxPrice: 200, sort: "price_desc" });
  });
});

test("existing direction subgroup and all-engine scopes remain available; unknown unions are rejected", async () => {
  await withTree(async (roots) => {
    for (const slug of ["engine-belt-pulleys", "engine", "cooling"]) {
      const calls = [];
      const result = await PublicCatalogService.getCategoryProducts({ slug: "engine-systems", directionSlug: "engine-systems", subgroupSlug: slug }, {
        async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; },
      });
      assert.deepEqual(calls[0].values[0], [categoryId(roots, slug)]);
      assert.equal(result.category.selectedSubgroup, slug);
      assert.equal(result.category.name, "Двигун та його системи");
    }
    const calls = [];
    const invalid = await PublicCatalogService.getCategoryProducts({ slug: "engine-systems", directionSlug: "engine-systems", subgroupSlug: "engine-unknown-union" }, {
      async query(...args) { calls.push(args); return { rows: [] }; },
    });
    assert.equal(invalid, null);
    assert.equal(calls.length, 0);
  });
});
