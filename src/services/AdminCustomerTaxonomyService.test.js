import test from "node:test";
import assert from "node:assert/strict";

import { AdminCustomerTaxonomyService } from "./AdminCustomerTaxonomyService.js";

test("customer taxonomy overview uses two aggregate repository calls without N+1", async () => {
  const calls = [];
  const repository = {
    async listTree(locale) {
      calls.push(["tree", locale]);
      return [{ id: 1, slug: "filters-maintenance" }];
    },
    async getIntegrity() {
      calls.push(["integrity"]);
      return { memberships: 901 };
    },
  };
  const result = await AdminCustomerTaxonomyService.getOverview(
    { locale: "ru" },
    { repository },
  );
  assert.deepEqual(calls, [["tree", "ru"], ["integrity"]]);
  assert.equal(result.integrity.memberships, 901);
});

test("product filters are normalized and pagination stays server-side", async () => {
  let received;
  const repository = {
    async searchProducts(query) {
      received = query;
      return { rows: [{ productId: 1 }], total: 126 };
    },
  };
  const result = await AdminCustomerTaxonomyService.searchProducts({
    locale: "en",
    categorySlug: "filters-oil",
    search: "A00018%_",
    assignmentSource: "rule",
    assignmentOrigin: "backfill",
    confidence: "high",
    approvalStatus: "auto_approved",
    ruleCode: "FILTER_OIL_A_EPC18_V1",
    numberFamily: "a",
    epcGroup: "18",
    page: "2",
    pageSize: "25",
  }, { repository });
  assert.deepEqual(received, {
    locale: "en",
    categorySlug: "filters-oil",
    searchPattern: "%A00018\\%\\_%",
    assignmentSource: "RULE",
    assignmentOrigin: "BACKFILL",
    confidence: "HIGH",
    approvalStatus: "AUTO_APPROVED",
    ruleCode: "FILTER_OIL_A_EPC18_V1",
    numberFamily: "A",
    epcGroup: "18",
    page: 2,
    pageSize: 25,
  });
  assert.deepEqual(result.pagination, {
    page: 2,
    pageSize: 25,
    total: 126,
    totalPages: 6,
    hasPrevious: true,
    hasNext: true,
  });
});

test("invalid read-only filters are rejected before querying the database", async () => {
  let called = false;
  const repository = {
    async searchProducts() {
      called = true;
      return { rows: [], total: 0 };
    },
  };
  await assert.rejects(
    AdminCustomerTaxonomyService.searchProducts(
      { assignmentSource: "IMPORT" },
      { repository },
    ),
    (error) => error.statusCode === 400,
  );
  assert.equal(called, false);
});
