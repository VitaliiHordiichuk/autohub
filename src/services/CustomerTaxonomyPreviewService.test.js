import test from "node:test";
import assert from "node:assert/strict";

import { runCustomerTaxonomyPreview } from "./CustomerTaxonomyPreviewService.js";

function fakePool() {
  const commands = [];
  const client = {
    async query(sql) {
      commands.push(String(sql).trim());
      return { rows: [] };
    },
    release() {
      commands.push("RELEASE");
    },
  };
  return { commands, connect: async () => client };
}

test("customer taxonomy preview uses READ ONLY transaction and performs zero writes", async () => {
  const dbPool = fakePool();
  const repository = {
    listProductsForPreview: async () => [{
      id: 10,
      article: "A0001800109",
      articleNormalized: "A0001800109",
      name: "Масляний фільтр",
      technicalEpcGroups: ["18"],
    }],
    listActiveRules: async () => [],
    listMemberships: async () => [],
  };
  const report = await runCustomerTaxonomyPreview({ dbPool, repository });
  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.summary.products, 1);
  assert.equal(report.summary.unclassified, 1);
  assert.equal(report.summary.autoApproved, 0);
  assert.equal(report.summary.review, 0);
  assert.equal(dbPool.commands[0], "BEGIN READ ONLY");
  assert.ok(dbPool.commands.includes("ROLLBACK"));
  assert.equal(
    dbPool.commands.some((command) => /^(INSERT|UPDATE|DELETE|COMMIT)\b/.test(command)),
    false,
  );
  assert.equal(dbPool.commands.at(-1), "RELEASE");
});

test("preview separates additions, removals, conflicts and REVIEW without version-only drift", async () => {
  const dbPool = fakePool();
  const repository = {
    listProductsForPreview: async () => [{
      id: 10,
      article: "A0001800109",
      technicalEpcGroups: ["18"],
    }],
    listActiveRules: async () => [{ code: "RULE_A", version: 2 }],
    listMemberships: async () => [{
      productId: 10,
      customerCategoryId: 99,
      assignmentSource: "RULE",
      ruleCode: "RULE_A",
      ruleVersion: 1,
      approvalStatus: "REVIEW",
      isPrimary: false,
    }, {
      productId: 10,
      customerCategoryId: 98,
      assignmentSource: "MANUAL",
      ruleCode: null,
      ruleVersion: null,
      approvalStatus: "MANUAL_APPROVED",
      isPrimary: true,
    }],
  };
  const resolver = () => ({
    unclassified: false,
    diagnostics: [],
    conflicts: [{ reason: "EQUAL_PRIMARY_STRENGTH" }],
    proposals: [{
      category: { id: 100, slug: "filters-oil", parentSlug: "filters-maintenance" },
      assignmentSource: "RULE",
      assignmentOrigin: "SYSTEM",
      ruleCode: "RULE_A",
      ruleVersion: 2,
      confidence: "MEDIUM",
      approvalStatus: "REVIEW",
      isPrimary: false,
    }],
  });
  const report = await runCustomerTaxonomyPreview({ dbPool, repository, resolver });
  assert.equal(report.summary.additions, 1);
  assert.equal(report.summary.removals, 1);
  assert.equal(report.summary.changedRules, 0);
  assert.equal(report.summary.conflicts, 1);
  assert.equal(report.summary.autoApproved, 0);
  assert.equal(report.summary.review, 1);
  assert.equal(
    report.removals.some((membership) => membership.assignmentSource === "MANUAL"),
    false,
  );
});

test("preview reports AUTO_APPROVED candidates and preserved manual primaries separately", async () => {
  const dbPool = fakePool();
  const repository = {
    listProductsForPreview: async () => [{
      id: 10,
      article: "A0001800109",
      technicalEpcGroups: ["18"],
    }, {
      id: 11,
      article: "A0001800110",
      name: "Ручна категорія",
      technicalEpcGroups: ["18"],
    }],
    listActiveRules: async () => [],
    listMemberships: async () => [],
  };
  const resolver = ({ product }) => {
    if (product.id === 11) {
      return {
        unclassified: false,
        diagnostics: [],
        conflicts: [],
        proposals: [],
        manualPrimaryPreserved: true,
        manualPrimary: { customerCategoryId: 999 },
      };
    }
    return {
      unclassified: false,
      diagnostics: [],
      conflicts: [],
      proposals: [{
        category: { id: 100, slug: "filters-oil", parentSlug: "filters-maintenance" },
        assignmentSource: "RULE",
        assignmentOrigin: "SYSTEM",
        ruleCode: "FILTER_OIL_A_EPC18_V1",
        ruleVersion: 1,
        confidence: "HIGH",
        approvalStatus: "AUTO_APPROVED",
        isPrimary: true,
      }],
    };
  };
  const report = await runCustomerTaxonomyPreview({ dbPool, repository, resolver });
  assert.equal(report.summary.autoApproved, 1);
  assert.equal(report.autoApproved[0].article, "A0001800109");
  assert.equal(report.summary.manualPreserved, 1);
  assert.deepEqual(report.manualPreserved, [{
    productId: 11,
    article: "A0001800110",
    name: "Ручна категорія",
    categoryId: 999,
  }]);
});

test("historical rule versions stay valid when the active successor resolves to the same category", async () => {
  const dbPool = fakePool();
  const repository = {
    listProductsForPreview: async () => [{
      id: 10,
      article: "A0001800109",
      name: "Масляний фільтр",
      technicalEpcGroups: ["18"],
    }],
    listActiveRules: async () => [{ code: "FILTER_OIL_A_EPC18_V1", version: 2 }],
    listMemberships: async () => [{
      productId: 10,
      customerCategoryId: 100,
      categorySlug: "filters-oil",
      assignmentSource: "RULE",
      ruleCode: "FILTER_OIL_A_EPC18_V1",
      ruleVersion: 1,
      approvalStatus: "AUTO_APPROVED",
      isPrimary: true,
    }],
  };
  const resolver = () => ({
    unclassified: false,
    diagnostics: [],
    conflicts: [],
    proposals: [{
      category: { id: 100, slug: "filters-oil", parentSlug: "filters-maintenance" },
      assignmentSource: "RULE",
      assignmentOrigin: "SYSTEM",
      ruleCode: "FILTER_OIL_A_EPC18_V1",
      ruleVersion: 2,
      confidence: "HIGH",
      approvalStatus: "AUTO_APPROVED",
      isPrimary: true,
    }],
  });

  const report = await runCustomerTaxonomyPreview({ dbPool, repository, resolver });
  assert.equal(report.summary.changedRules, 0);
  assert.equal(report.summary.removals, 0);
  assert.deepEqual(report.summary.classificationDrift, {
    sameCategory: 1,
    differentCategory: 0,
    noLongerMatches: 0,
  });
  assert.equal(report.classificationDrift.sameCategory[0].existing.ruleVersion, 1);
  assert.equal(report.classificationDrift.sameCategory[0].proposed.ruleVersion, 2);
});
