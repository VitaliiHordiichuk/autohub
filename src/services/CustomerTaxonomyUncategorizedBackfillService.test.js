import assert from "node:assert/strict";
import test from "node:test";

import {
  runUncategorizedBackfill,
  UNCATEGORIZED_BACKFILL_APPLY_CONFIRMATION,
  UNCATEGORIZED_BACKFILL_RESTORE_CONFIRMATION,
} from "./CustomerTaxonomyUncategorizedBackfillService.js";

function fixture({ article = "A2976709601" } = {}) {
  const state = new Map();
  const queries = [];
  const product = {
    id: 6655,
    article,
    name: "Скло лобове",
    technicalEpcGroups: ["67"],
  };
  const proposal = {
    category: { id: 400, slug: "body-windshields", parentSlug: "body-glass" },
    isPrimary: true,
    assignmentSource: "RULE",
    assignmentOrigin: "BACKFILL",
    ruleCode: "GLASS_WINDSHIELD_A_EPC67_V1",
    ruleVersion: 1,
    confidence: "HIGH",
    approvalStatus: "AUTO_APPROVED",
  };
  const db = {
    query: async (sql) => {
      queries.push(sql.trim());
      if (sql.includes("SELECT product.id FROM products")) return { rows: [{ id: product.id }] };
      if (sql.includes("DELETE FROM product_customer_categories")) {
        const found = state.has(product.id);
        state.delete(product.id);
        return { rowCount: found ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  const repository = {
    lockProductForAssignment: async () => {},
    findProductForResolution: async () => product,
    listMembershipsForProduct: async (id) => state.get(id) || [],
  };
  const taxonomyService = {
    createContext: async () => ({ rules: [proposal] }),
    evaluateProduct: async () => ({
      product,
      candidate: proposal,
      resolution: { typeCodes: ["GLASS_WINDSHIELD"], proposals: [proposal] },
      disposition: { requiresReview: false, reason: null },
    }),
  };
  const assignmentService = {
    applyResolutionInTransaction: async () => {
      const membership = {
        productId: product.id,
        customerCategoryId: 400,
        categorySlug: "body-windshields",
        isPrimary: true,
        assignmentSource: "RULE",
        assignmentOrigin: "BACKFILL",
        ruleCode: proposal.ruleCode,
        ruleVersion: 1,
        confidence: "HIGH",
        approvalStatus: "AUTO_APPROVED",
      };
      state.set(product.id, [membership]);
      return { applied: [membership] };
    },
  };
  return { state, queries, product, dbPool: { connect: async () => db }, repository, taxonomyService, assignmentService };
}

test("dry-run is read-only; explicit bounded plan applies and restores exactly its own assignment", async () => {
  const environment = fixture();
  const options = {
    dbPool: environment.dbPool,
    repository: environment.repository,
    taxonomyService: environment.taxonomyService,
    assignmentService: environment.assignmentService,
  };
  const preview = await runUncategorizedBackfill({ ...options, afterId: 6653, limit: 102 });
  assert.deepEqual(preview.counts, { autoHigh: 1, review: 0, unknown: 0 });
  assert.equal(preview.rows[0].detectedTypeCodes[0], "GLASS_WINDSHIELD");
  assert.equal(environment.state.size, 0);
  assert.ok(environment.queries.includes("ROLLBACK"));

  await assert.rejects(
    () => runUncategorizedBackfill({ ...options, mode: "APPLY", plan: preview.plan }),
    /Missing confirmation/,
  );
  const applied = await runUncategorizedBackfill({
    ...options, mode: "APPLY", plan: preview.plan,
    confirmation: UNCATEGORIZED_BACKFILL_APPLY_CONFIRMATION,
  });
  assert.deepEqual(applied.applied, [6655]);
  assert.equal(environment.state.size, 1);

  const restored = await runUncategorizedBackfill({
    ...options, mode: "RESTORE", plan: preview.plan,
    confirmation: UNCATEGORIZED_BACKFILL_RESTORE_CONFIRMATION,
  });
  assert.deepEqual(restored.restored, [6655]);
  assert.equal(environment.state.size, 0);
});

test("a newer manual category makes the reviewed plan stale and is never overwritten", async () => {
  const environment = fixture();
  const options = {
    dbPool: environment.dbPool,
    repository: environment.repository,
    taxonomyService: environment.taxonomyService,
    assignmentService: environment.assignmentService,
  };
  const preview = await runUncategorizedBackfill(options);
  environment.state.set(6655, [{
    productId: 6655,
    categorySlug: "body-glass",
    assignmentSource: "MANUAL",
    approvalStatus: "MANUAL_APPROVED",
    isPrimary: true,
  }]);
  await assert.rejects(() => runUncategorizedBackfill({
    ...options, mode: "APPLY", plan: preview.plan,
    confirmation: UNCATEGORIZED_BACKFILL_APPLY_CONFIRMATION,
  }), /Stale backfill plan/);
  assert.equal(environment.state.get(6655)[0].assignmentSource, "MANUAL");
});

test("apply is limited to 25 unique products", async () => {
  const plan = Array.from({ length: 26 }, (_, index) => ({
    productId: index + 1,
    article: `A000000${index}`,
    categorySlug: "body-windshields",
    ruleCode: "GLASS_WINDSHIELD_A_EPC67_V1",
    ruleVersion: 1,
  }));
  await assert.rejects(() => runUncategorizedBackfill({
    mode: "APPLY", plan,
    confirmation: UNCATEGORIZED_BACKFILL_APPLY_CONFIRMATION,
  }), /1 to 25/);
});

test("three unverified HIGH products are absent from plans and cannot be applied", async () => {
  for (const article of ["A1635401417", "A270094000490", "B66959719"]) {
    const environment = fixture({ article });
    const options = {
      dbPool: environment.dbPool,
      repository: environment.repository,
      taxonomyService: environment.taxonomyService,
      assignmentService: environment.assignmentService,
    };
    const preview = await runUncategorizedBackfill(options);
    assert.equal(preview.rows[0].status, "REVIEW_OEM", article);
    assert.deepEqual(preview.plan, [], article);
    assert.deepEqual(preview.counts, { autoHigh: 0, review: 1, unknown: 0 }, article);
    await assert.rejects(() => runUncategorizedBackfill({
      ...options,
      mode: "APPLY",
      plan: [{
        productId: environment.product.id,
        article,
        categorySlug: "body-windshields",
        ruleCode: "GLASS_WINDSHIELD_A_EPC67_V1",
        ruleVersion: 1,
      }],
      confirmation: UNCATEGORIZED_BACKFILL_APPLY_CONFIRMATION,
    }), /Stale backfill plan/, article);
    assert.equal(environment.state.size, 0, article);
  }
});
