import test from "node:test";
import assert from "node:assert/strict";

import { CUSTOMER_TAXONOMY_PHASE2F_REVIEW } from "../data/CustomerTaxonomyPhase2FReview.js";
import { buildCustomerTaxonomyPhase2FCoverage } from "./CustomerTaxonomyPhase2FPreviewService.js";

function buildAcceptedAuditFixture() {
  const evaluations = CUSTOMER_TAXONOMY_PHASE2F_REVIEW.map((row, index) => ({
    productId: index + 1,
    article: row.article,
    name: row.name,
    technicalEpc: row.epc ? [row.epc] : [],
    detectedTypeCodes: row.typeCode ? [row.typeCode] : [],
    existingMemberships: row.originalBucket === "ALREADY_MEMBER" ? [{
      isPrimary: true,
      approvalStatus: "AUTO_APPROVED",
      categorySlug: row.categorySlug,
      parentSlug: row.targetSection,
    }] : [],
  }));
  const additions = CUSTOMER_TAXONOMY_PHASE2F_REVIEW
    .map((row, index) => ({ row, productId: index + 1 }))
    .filter(({ row }) => row.finalBucket === "HIGH")
    .map(({ row, productId }) => ({
      productId,
      categoryId: productId + 20000,
      categorySlug: row.categorySlug,
      approvalStatus: "AUTO_APPROVED",
      assignmentSource: "RULE",
      ruleCode: `${row.typeCode}_A_EPC${row.epc}_PHASE2F_V1`,
      ruleVersion: 1,
    }));
  return { evaluations, additions };
}

test("accepted PHASE 2F audit reconciles every reviewed product exactly", () => {
  const coverage = buildCustomerTaxonomyPhase2FCoverage(buildAcceptedAuditFixture());
  assert.deepEqual({
    technicalTotal: coverage.summary.technicalTotal,
    sourceProductsFound: coverage.summary.sourceProductsFound,
    alreadyMember: coverage.summary.alreadyMember,
    newHigh: coverage.summary.newHigh,
    safeTopLevel: coverage.summary.safeTopLevel,
    missingRuleRemaining: coverage.summary.missingRuleRemaining,
    realReview: coverage.summary.realReview,
    crossSectionAssignments: coverage.summary.crossSectionAssignments,
    suspicious: coverage.summary.suspicious,
  }, {
    technicalTotal: 1360,
    sourceProductsFound: 1360,
    alreadyMember: 230,
    newHigh: 765,
    safeTopLevel: 99,
    missingRuleRemaining: 0,
    realReview: 266,
    crossSectionAssignments: 360,
    suspicious: 0,
  });
  assert.deepEqual(coverage.summary.bySection, {
    engine: {
      technicalTotal: 775,
      alreadyMember: 208,
      newHigh: 374,
      safeTopLevel: 58,
      missingRuleRemaining: 0,
      realReview: 135,
    },
    suspension: {
      technicalTotal: 585,
      alreadyMember: 22,
      newHigh: 391,
      safeTopLevel: 41,
      missingRuleRemaining: 0,
      realReview: 131,
    },
  });
});

test("PHASE 2F reconciliation protects existing, promotes only missing rules and retains review", () => {
  const coverage = buildCustomerTaxonomyPhase2FCoverage(buildAcceptedAuditFixture());
  assert.deepEqual(coverage.summary.reconciliation, {
    originalHigh: { finalHigh: 737, finalReview: 0 },
    originalSafe: { finalSafe: 99, finalHigh: 0, finalReview: 0 },
    originalMissingRule: { finalHigh: 28, finalSafe: 0, finalReview: 0 },
    originalReview: { unchanged: 266, promotedHigh: 0, promotedSafe: 0 },
    alreadyMemberProtected: 230,
  });
  assert.ok(coverage.realReview.every((item) => item.finalBucket === "REAL_REVIEW"));
  assert.ok(coverage.alreadyMember.every((item) => item.originalBucket === "ALREADY_MEMBER"));
});

test("all 52 PHASE 2E belt-drive deferrals reconcile to 47 HIGH and five reviewed Engine SAFE", () => {
  const coverage = buildCustomerTaxonomyPhase2FCoverage(buildAcceptedAuditFixture());
  assert.deepEqual(coverage.summary.deferredFromPhase2E, {
    total: 52,
    high: 47,
    safeTopLevel: 5,
    realReview: 0,
    highByLeaf: {
      "engine-belt-pulleys": 2,
      "engine-belt-rollers-idlers": 4,
      "engine-belt-tensioners": 41,
    },
  });
  assert.deepEqual(
    coverage.deferredFromPhase2E
      .filter((item) => item.finalBucket === "SAFE_TOPLEVEL")
      .map((item) => item.article)
      .sort(),
    [
      "A0002021619",
      "A0002021719",
      "A1032000570",
      "A1112020119",
      "A2712000470",
    ],
  );
});
