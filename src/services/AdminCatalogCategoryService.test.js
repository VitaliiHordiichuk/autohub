import assert from "node:assert/strict";
import test from "node:test";

import { AdminCatalogCategoryService } from "./AdminCatalogCategoryService.js";

function fakeSearchDatabase(overrides = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("COUNT(*)::integer AS count")) return { rows: [{ count: 7 }] };
      return { rows: [{
        id: 91, article: "A0008208112", name: "Контрольний товар",
        technical_epc_group: "82", customer_category_id: 12,
        customer_category_slug: "electrical-electronics-lighting",
        customer_category_parent_id: null,
        customer_category_name_uk: "Електрика",
        customer_category_name_ru: "Электрика",
        customer_category_name_en: "Electrical",
        public_assignment_source: "EPC_FALLBACK",
        image_count: 0,
        ...overrides,
      }] };
    },
  };
}

test("classification predicates are applied to both count and page before LIMIT", async () => {
  const filters = {
    NO_PUBLIC_CATEGORY: /NOT EXISTS \(\s*SELECT 1 FROM product_customer_categories primary_assignment/,
    ROOT_ONLY: /public_category\.parent_id IS NULL/,
    REVIEW: /review_assignment\.approval_status = 'REVIEW'/,
    EXACT_SUBGROUP: /public_category\.parent_id IS NOT NULL/,
  };
  for (const [classification, predicate] of Object.entries(filters)) {
    const db = fakeSearchDatabase();
    const result = await AdminCatalogCategoryService.searchProducts({ classification, page: 2, limit: 2 }, db);
    assert.equal(result.pagination.total, 7);
    assert.equal(result.pagination.page, 2);
    assert.equal(db.calls.length, 3);
    assert.match(db.calls[0].sql, predicate);
    assert.match(db.calls[1].sql, predicate);
    assert.doesNotMatch(db.calls[0].sql, /\bLIMIT \$/);
    if (classification === "REVIEW") {
      assert.match(db.calls[0].sql, /article_normalized.*= ANY\(\$1::text\[\]\)/);
      assert.ok(db.calls[0].values[0].includes("A0009053119"));
      assert.match(db.calls[1].sql, /LIMIT \$2 OFFSET \$3/);
      assert.deepEqual(db.calls[1].values.slice(1), [2, 2]);
    } else {
      assert.match(db.calls[1].sql, /LIMIT \$1 OFFSET \$2/);
      assert.deepEqual(db.calls[1].values, [2, 2]);
    }
  }
});

test("classification response keeps EPC and public root distinct from legacy category", async () => {
  const result = await AdminCatalogCategoryService.searchProducts({}, fakeSearchDatabase());
  assert.equal(result.products[0].technicalEpcGroup, "82");
  assert.equal(result.products[0].classification, "ROOT_ONLY");
  assert.equal(result.products[0].publicCategory.slug, "electrical-electronics-lighting");
  assert.equal(result.products[0].publicAssignmentSource, "EPC_FALLBACK");
  assert.equal(result.products[0].category, null);
});

test("persisted review outcome is distinct from a missing category and carries its reason", async () => {
  const result = await AdminCatalogCategoryService.searchProducts({}, fakeSearchDatabase({
    customer_category_id: null,
    import_decision: "REQUIRES_REVIEW",
    import_reason: "NO_TECHNICAL_EPC",
  }));
  assert.equal(result.products[0].classification, "REVIEW");
  assert.equal(result.products[0].publicCategory, null);
  assert.equal(result.products[0].reviewReason, "NO_TECHNICAL_EPC");
});

test("historical REAL_REVIEW without a stored decision remains visible", async () => {
  const result = await AdminCatalogCategoryService.searchProducts({}, fakeSearchDatabase({
    article: "A0009053119",
    article_normalized: "A0009053119",
    customer_category_id: null,
    import_decision: null,
    has_review: null,
  }));
  assert.equal(result.products[0].classification, "REVIEW");
  assert.match(result.products[0].reviewReason, /^HISTORICAL_REAL_REVIEW:/);
});

test("unknown classification filter is rejected before database access", async () => {
  const db = fakeSearchDatabase();
  await assert.rejects(
    AdminCatalogCategoryService.searchProducts({ classification: "UNSUPPORTED" }, db),
    { statusCode: 400 },
  );
  assert.equal(db.calls.length, 0);
});
