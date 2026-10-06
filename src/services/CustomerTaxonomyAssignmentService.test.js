import assert from "node:assert/strict";
import test from "node:test";

import { CustomerTaxonomyAssignmentService } from "./CustomerTaxonomyAssignmentService.js";
import {
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_TAXONOMY_DECISION,
} from "./CustomerTaxonomyResolver.js";

function highProposal(categoryId = 20) {
  return {
    category: { id: categoryId, slug: `leaf-${categoryId}` },
    isPrimary: true,
    assignmentSource: "RULE",
    assignmentOrigin: "SYSTEM",
    ruleCode: `RULE_${categoryId}`,
    ruleVersion: 1,
    confidence: "HIGH",
    approvalStatus: "AUTO_APPROVED",
  };
}

function safeProposal(categoryId = 30) {
  return {
    category: { id: categoryId, slug: `root-${categoryId}` },
    isPrimary: true,
    assignmentSource: "EPC_FALLBACK",
    assignmentOrigin: "BACKFILL",
    ruleCode: null,
    ruleVersion: null,
    confidence: "MEDIUM",
    approvalStatus: "AUTO_APPROVED",
  };
}

function approvedRulePrimary(overrides = {}) {
  return {
    productId: 1,
    customerCategoryId: 10,
    categorySlug: "existing-leaf",
    categoryStatus: "ACTIVE",
    categoryIsActive: true,
    isPrimary: true,
    assignmentSource: "RULE",
    assignmentOrigin: "BACKFILL",
    ruleCode: "HISTORICAL_RULE",
    ruleVersion: 1,
    historicalRuleExists: true,
    historicalRuleIsActive: false,
    historicalRuleTargetCategoryId: 10,
    confidence: "HIGH",
    approvalStatus: "AUTO_APPROVED",
    ...overrides,
  };
}

function approvedSafePrimary(overrides = {}) {
  return {
    productId: 1,
    customerCategoryId: 11,
    categorySlug: "existing-root",
    categoryStatus: "ACTIVE",
    categoryIsActive: true,
    isPrimary: true,
    assignmentSource: "EPC_FALLBACK",
    assignmentOrigin: "BACKFILL",
    ruleCode: null,
    ruleVersion: null,
    confidence: "MEDIUM",
    approvalStatus: "AUTO_APPROVED",
    ...overrides,
  };
}

function manualPrimary(overrides = {}) {
  return {
    productId: 1,
    customerCategoryId: 12,
    categorySlug: "manual-leaf",
    categoryStatus: "ACTIVE",
    categoryIsActive: true,
    isPrimary: true,
    assignmentSource: "MANUAL",
    assignmentOrigin: "ADMIN",
    ruleCode: null,
    ruleVersion: null,
    confidence: "HIGH",
    approvalStatus: "MANUAL_APPROVED",
    ...overrides,
  };
}

function createRepository(initialMemberships = []) {
  let memberships = initialMemberships.map((membership) => ({ ...membership }));
  const repository = {
    async lockProductForAssignment() {},
    async listMembershipsForProduct() {
      return memberships.map((membership) => ({ ...membership }));
    },
    async demoteAutomaticPrimary() {
      memberships = memberships.map((membership) => (
        membership.isPrimary && membership.assignmentSource !== "MANUAL"
          ? { ...membership, isPrimary: false }
          : membership
      ));
    },
    async upsertMembership(input) {
      const existingIndex = memberships.findIndex((membership) => (
        membership.customerCategoryId === input.customerCategoryId
      ));
      const row = {
        ...input,
        categorySlug: `category-${input.customerCategoryId}`,
        categoryStatus: "ACTIVE",
        categoryIsActive: true,
        historicalRuleExists: input.assignmentSource === "RULE" ? true : null,
        historicalRuleTargetCategoryId: input.assignmentSource === "RULE"
          ? input.customerCategoryId
          : null,
      };
      if (existingIndex >= 0) memberships[existingIndex] = row;
      else memberships.push(row);
      return { ...row };
    },
    snapshot() {
      return memberships.map((membership) => ({ ...membership }));
    },
    restore(snapshot) {
      memberships = snapshot.map((membership) => ({ ...membership }));
    },
  };
  return repository;
}

async function applyInTransaction({
  existing = [],
  proposals = [],
  allowApprovedPrimaryReplacement = false,
  approvedPrimaryReplacementReason = null,
} = {}) {
  const repository = createRepository(existing);
  const result = await CustomerTaxonomyAssignmentService.applyResolutionInTransaction({
    productId: 1,
    resolution: { proposals },
    assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.SYSTEM,
    allowApprovedPrimaryReplacement,
    approvedPrimaryReplacementReason,
  }, { db: { query: async () => ({}) }, repository });
  return { result, rows: repository.snapshot(), repository };
}

test("no existing primary assigns new HIGH and SAFE proposals", async () => {
  const high = await applyInTransaction({ proposals: [highProposal()] });
  assert.equal(high.result.decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_NEW_HIGH);
  assert.equal(high.rows[0].isPrimary, true);

  const safe = await applyInTransaction({ proposals: [safeProposal()] });
  assert.equal(safe.result.decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_SAFE);
  assert.equal(safe.rows[0].confidence, "MEDIUM");
});

test("MANUAL is preserved even when generic explicit override is requested", async () => {
  const { result, rows } = await applyInTransaction({
    existing: [manualPrimary()],
    proposals: [highProposal()],
    allowApprovedPrimaryReplacement: true,
    approvedPrimaryReplacementReason: "controlled attempt",
  });
  assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.PRESERVE_MANUAL);
  assert.equal(result.applied.length, 0);
  assert.deepEqual(rows, [manualPrimary()]);
});

test("approved RULE primary survives different HIGH and empty detector output", async () => {
  const changed = await applyInTransaction({
    existing: [approvedRulePrimary()],
    proposals: [highProposal()],
  });
  assert.equal(
    changed.result.decision,
    CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
  );
  assert.deepEqual(changed.rows, [approvedRulePrimary()]);

  const noCandidate = await applyInTransaction({
    existing: [approvedRulePrimary({ historicalRuleIsActive: false })],
    proposals: [],
  });
  assert.equal(
    noCandidate.result.decision,
    CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
  );
  assert.equal(noCandidate.result.applied.length, 0);
});

test("approved SAFE primary is not upgraded by HIGH or another SAFE automatically", async () => {
  for (const proposal of [highProposal(), safeProposal(31)]) {
    const { result, rows } = await applyInTransaction({
      existing: [approvedSafePrimary()],
      proposals: [proposal],
    });
    assert.equal(
      result.decision,
      CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
    );
    assert.deepEqual(rows, [approvedSafePrimary()]);
  }
});

test("inactive target and missing historical rule return explicit integrity decisions", async () => {
  const inactive = await applyInTransaction({
    existing: [approvedSafePrimary({ categoryIsActive: false })],
    proposals: [highProposal()],
  });
  assert.equal(inactive.result.decision, CUSTOMER_TAXONOMY_DECISION.INVALID_EXISTING_PRIMARY);
  assert.deepEqual(inactive.result.decisionIssues, ["INACTIVE_TARGET_CATEGORY"]);
  assert.equal(inactive.result.applied.length, 0);

  const missing = await applyInTransaction({
    existing: [approvedRulePrimary({ historicalRuleExists: false })],
    proposals: [highProposal()],
  });
  assert.equal(missing.result.decision, CUSTOMER_TAXONOMY_DECISION.INVALID_EXISTING_PRIMARY);
  assert.deepEqual(missing.result.decisionIssues, ["MISSING_HISTORICAL_RULE_VERSION"]);
  assert.equal(missing.result.applied.length, 0);
});

test("rejected or unapproved membership does not block a different HIGH", async () => {
  const rejected = approvedRulePrimary({
    customerCategoryId: 10,
    isPrimary: false,
    approvalStatus: "REJECTED",
  });
  const { result, rows } = await applyInTransaction({
    existing: [rejected],
    proposals: [highProposal(20)],
  });
  assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_NEW_HIGH);
  assert.equal(rows.find((row) => row.customerCategoryId === 20).isPrimary, true);

  const review = await applyInTransaction({
    existing: [approvedRulePrimary({
      isPrimary: true,
      approvalStatus: "REVIEW",
    })],
    proposals: [highProposal(21)],
  });
  assert.equal(review.result.decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_NEW_HIGH);
  assert.equal(review.rows.filter((row) => row.isPrimary).length, 1);
  assert.equal(review.rows.find((row) => row.isPrimary).customerCategoryId, 21);
});

test("explicit controlled override replaces only automatic primary and records reason", async () => {
  await assert.rejects(
    applyInTransaction({
      existing: [approvedRulePrimary()],
      proposals: [highProposal()],
      allowApprovedPrimaryReplacement: true,
    }),
    /requires approvedPrimaryReplacementReason/,
  );

  const { result, rows } = await applyInTransaction({
    existing: [approvedRulePrimary()],
    proposals: [highProposal()],
    allowApprovedPrimaryReplacement: true,
    approvedPrimaryReplacementReason: "PHASE 3D controlled test",
  });
  assert.equal(
    result.decision,
    CUSTOMER_TAXONOMY_DECISION.REPLACED_BY_EXPLICIT_OVERRIDE,
  );
  assert.equal(result.approvedPrimaryReplacementReason, "PHASE 3D controlled test");
  assert.equal(rows.filter((row) => row.isPrimary).length, 1);
  assert.equal(rows.find((row) => row.isPrimary).customerCategoryId, 20);
});

test("applyResolution rolls back a failed explicit replacement", async () => {
  const repository = createRepository([approvedRulePrimary()]);
  const originalUpsert = repository.upsertMembership;
  repository.upsertMembership = async (...args) => {
    await originalUpsert(...args);
    throw new Error("simulated write failure");
  };
  let transactionSnapshot = null;
  const client = {
    async query(sql) {
      if (sql === "BEGIN") transactionSnapshot = repository.snapshot();
      if (sql === "ROLLBACK") repository.restore(transactionSnapshot);
      return {};
    },
    release() {},
  };
  await assert.rejects(CustomerTaxonomyAssignmentService.applyResolution({
    productId: 1,
    resolution: { proposals: [highProposal()] },
    assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.SYSTEM,
    allowApprovedPrimaryReplacement: true,
    approvedPrimaryReplacementReason: "rollback test",
  }, {
    dbPool: { async connect() { return client; } },
    repository,
  }), /simulated write failure/);
  assert.deepEqual(repository.snapshot(), [approvedRulePrimary()]);
});
