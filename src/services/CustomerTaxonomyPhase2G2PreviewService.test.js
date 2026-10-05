import test from "node:test";
import assert from "node:assert/strict";

import { CUSTOMER_TAXONOMY_PHASE2G2_REVIEW } from "../data/CustomerTaxonomyPhase2G2Review.js";
import { buildCustomerTaxonomyPhase2G2Coverage } from "./CustomerTaxonomyPhase2G2PreviewService.js";

function acceptedAuditFixture() {
  const evaluations = CUSTOMER_TAXONOMY_PHASE2G2_REVIEW.map((row, index) => ({
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
  const additions = CUSTOMER_TAXONOMY_PHASE2G2_REVIEW
    .map((row, index) => ({ row, productId: index + 1 }))
    .filter(({ row }) => row.finalBucket === "HIGH")
    .map(({ row, productId }) => ({
      productId,
      categoryId: productId + 40000,
      categorySlug: row.categorySlug,
      approvalStatus: "AUTO_APPROVED",
      assignmentSource: "RULE",
      ruleCode: `${row.typeCode}_A_EPC${row.epc}_PHASE2G2_V1`,
      ruleVersion: 1,
    }));
  return { evaluations, additions };
}

test("accepted PHASE 2G.2 audit reconciles all 1023 unique Electrical products", () => {
  const coverage = buildCustomerTaxonomyPhase2G2Coverage(acceptedAuditFixture());
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
    technicalTotal: 1023,
    sourceProductsFound: 1023,
    alreadyMember: 13,
    newHigh: 310,
    safeTopLevel: 379,
    missingRuleRemaining: 0,
    realReview: 321,
    suspicious: 0,
  });
  assert.deepEqual(coverage.summary.bySection, {
    "electrical-electronics-lighting": {
      technicalTotal: 1023,
      alreadyMember: 13,
      newHigh: 310,
      safeTopLevel: 379,
      missingRuleRemaining: 0,
      realReview: 321,
    },
  });
  assert.equal(new Set(CUSTOMER_TAXONOMY_PHASE2G2_REVIEW.map((row) => row.article)).size, 1023);
});

test("PHASE 2G.2 reconciliation keeps accepted HIGH, SAFE and REVIEW unchanged", () => {
  const coverage = buildCustomerTaxonomyPhase2G2Coverage(acceptedAuditFixture());
  assert.deepEqual(coverage.summary.reconciliation, {
    originalHigh: { finalHigh: 310, finalSafe: 0, finalReview: 0 },
    originalSafe: { finalSafe: 379, finalHigh: 0, finalReview: 0 },
    originalReview: { unchanged: 321, promotedHigh: 0, promotedSafe: 0 },
    alreadyMemberProtected: 13,
  });
  assert.deepEqual(coverage.summary.collisionBreakdown, {
    "Electrical ↔ Brakes": 9,
    "Electrical ↔ Climate": 3,
    "Electrical ↔ Engine": 11,
    "Electrical ↔ Exhaust": 35,
    "Electrical ↔ Fuel": 6,
    "Electrical ↔ Suspension": 3,
    "Electrical ↔ wheels": 9,
  });
  assert.equal(Object.values(coverage.summary.realReviewByReason)
    .reduce((sum, count) => sum + count, 0), 321);
  assert.equal(coverage.summary.realReviewByReason[
    "Electrical name has no Mercedes EPC context; name-only classification is not approved"
  ], 78);
  assert.ok(coverage.realReview.every((item) => item.finalBucket === "REAL_REVIEW"));
});

test("PHASE 2G.2 creates exactly the 19 approved Electrical leaves", () => {
  const coverage = buildCustomerTaxonomyPhase2G2Coverage(acceptedAuditFixture());
  assert.deepEqual(coverage.summary.highByLeaf, {
    "electrical-alternators": 7,
    "electrical-antennas": 6,
    "electrical-batteries": 10,
    "electrical-cameras": 10,
    "electrical-connectors-plugs": 28,
    "electrical-control-units": 62,
    "electrical-driver-assistance": 5,
    "electrical-fuse-boxes": 12,
    "electrical-fuses": 6,
    "electrical-infotainment": 4,
    "electrical-parking-sensors": 9,
    "electrical-relays": 9,
    "electrical-sensors": 21,
    "electrical-starters": 5,
    "electrical-switches-controls": 11,
    "electrical-wiring-harnesses": 59,
    "lighting-bulbs": 4,
    "lighting-fog-lights": 6,
    "lighting-headlights": 36,
  });
  assert.equal(new Set(coverage.newHigh.map((item) => item.categorySlug)).size, 19);
  assert.equal(coverage.newHigh.some((item) => item.categorySlug === "lighting-tail-lights"), false);
  assert.equal(coverage.newHigh.some((item) => item.categorySlug === "lighting-interior"), false);
});
