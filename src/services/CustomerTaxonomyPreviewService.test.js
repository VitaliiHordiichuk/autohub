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
  assert.equal(dbPool.commands[0], "BEGIN READ ONLY");
  assert.ok(dbPool.commands.includes("ROLLBACK"));
  assert.equal(
    dbPool.commands.some((command) => /^(INSERT|UPDATE|DELETE|COMMIT)\b/.test(command)),
    false,
  );
  assert.equal(dbPool.commands.at(-1), "RELEASE");
});

test("preview separates additions, removals, changed rules, conflicts and REVIEW", async () => {
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
  assert.equal(report.summary.changedRules, 1);
  assert.equal(report.summary.conflicts, 1);
  assert.equal(report.summary.review, 1);
  assert.equal(
    report.removals.some((membership) => membership.assignmentSource === "MANUAL"),
    false,
  );
});
