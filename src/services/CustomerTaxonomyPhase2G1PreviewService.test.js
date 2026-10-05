import test from "node:test";
import assert from "node:assert/strict";

import { CUSTOMER_TAXONOMY_PHASE2G1_REVIEW } from "../data/CustomerTaxonomyPhase2G1Review.js";
import { buildCustomerTaxonomyPhase2G1Coverage } from "./CustomerTaxonomyPhase2G1PreviewService.js";

function acceptedAuditFixture() {
  const evaluations = CUSTOMER_TAXONOMY_PHASE2G1_REVIEW.map((row, index) => ({
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
  const additions = CUSTOMER_TAXONOMY_PHASE2G1_REVIEW
    .map((row, index) => ({ row, productId: index + 1 }))
    .filter(({ row }) => row.finalBucket === "HIGH")
    .map(({ row, productId }) => ({
      productId,
      categoryId: productId + 30000,
      categorySlug: row.categorySlug,
      approvalStatus: "AUTO_APPROVED",
      assignmentSource: "RULE",
      ruleCode: `${row.typeCode}_A_EPC${row.epc}_PHASE2G1_V1`,
      ruleVersion: 1,
    }));
  return { evaluations, additions };
}

test("accepted PHASE 2G.1 audit reconciles all 962 unique products", () => {
  const coverage = buildCustomerTaxonomyPhase2G1Coverage(acceptedAuditFixture());
  assert.deepEqual({
    technicalTotal: coverage.summary.technicalTotal,
    sourceProductsFound: coverage.summary.sourceProductsFound,
    alreadyMember: coverage.summary.alreadyMember,
    newHigh: coverage.summary.newHigh,
    safeTopLevel: coverage.summary.safeTopLevel,
    missingRuleRemaining: coverage.summary.missingRuleRemaining,
    realReview: coverage.summary.realReview,
    suspicious: coverage.summary.suspicious,
  }, {
    technicalTotal: 962,
    sourceProductsFound: 962,
    alreadyMember: 1,
    newHigh: 319,
    safeTopLevel: 427,
    missingRuleRemaining: 0,
    realReview: 215,
    suspicious: 0,
  });
  assert.deepEqual(coverage.summary.bySection, {
    "body-glass": {
      technicalTotal: 725,
      alreadyMember: 1,
      newHigh: 264,
      safeTopLevel: 286,
      missingRuleRemaining: 0,
      realReview: 174,
    },
    "interior-safety": {
      technicalTotal: 237,
      alreadyMember: 0,
      newHigh: 55,
      safeTopLevel: 141,
      missingRuleRemaining: 0,
      realReview: 41,
    },
  });
});

test("PHASE 2G.1 reconciliation keeps accepted HIGH, SAFE and REVIEW unchanged", () => {
  const coverage = buildCustomerTaxonomyPhase2G1Coverage(acceptedAuditFixture());
  assert.deepEqual(coverage.summary.reconciliation, {
    originalHigh: { finalHigh: 319, finalSafe: 0, finalReview: 0 },
    originalSafe: { finalSafe: 427, finalHigh: 0, finalReview: 0 },
    originalReview: { unchanged: 215, promotedHigh: 0, promotedSafe: 0 },
    alreadyMemberProtected: 1,
  });
  assert.equal(new Set(CUSTOMER_TAXONOMY_PHASE2G1_REVIEW.map((row) => row.article)).size, 962);
  assert.ok(coverage.realReview.every((item) => item.finalBucket === "REAL_REVIEW"));
});

test("PHASE 2G.1 creates only approved 18 Body and six Interior leaf groups", () => {
  const coverage = buildCustomerTaxonomyPhase2G1Coverage(acceptedAuditFixture());
  const bodyLeaves = new Set(coverage.newHigh
    .filter((item) => item.section === "body-glass")
    .map((item) => item.categorySlug));
  const interiorLeaves = new Set(coverage.newHigh
    .filter((item) => item.section === "interior-safety")
    .map((item) => item.categorySlug));
  assert.equal(bodyLeaves.size, 18);
  assert.equal(interiorLeaves.size, 6);
  assert.equal(bodyLeaves.has("body-side-windows"), true);
  assert.equal(bodyLeaves.has("body-window-regulators"), false);
  assert.equal(interiorLeaves.has("interior-dashboard"), false);
  assert.equal(interiorLeaves.has("interior-center-console"), false);
});
