import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCustomerTaxonomyBatch2Coverage,
  buildCustomerTaxonomyBatch2Report,
} from "./CustomerTaxonomyBatchPreviewService.js";

function item(parentSlug, overrides = {}) {
  return {
    productId: 1,
    parentSlug,
    categorySlug: `${parentSlug}-leaf`,
    approvalStatus: "AUTO_APPROVED",
    ...overrides,
  };
}

test("PHASE 2D preview separates existing memberships from new batch candidates", () => {
  const report = buildCustomerTaxonomyBatch2Report({
    mode: "DRY_RUN",
    summary: { existingMemberships: 901 },
    additions: [item("steering"), item("exhaust"), item("wheels"), item("brakes")],
    autoApproved: [item("steering"), item("exhaust"), item("wheels"), item("brakes")],
    review: [item("steering", { approvalStatus: "REVIEW" }), item("brakes")],
    conflicts: [{ conflicts: [{ candidates: [{ category: { parentSlug: "wheels" } }] }] }],
    unclassified: [
      { detectedTypeCodes: ["STEERING_RACK"] },
      { detectedTypeCodes: ["BRAKE_PAD"] },
    ],
  });

  assert.deepEqual(report.summary, {
    existingMemberships: 901,
    newBatchCandidates: 3,
    futureTotalMemberships: 904,
    autoApproved: 3,
    review: 1,
    conflicts: 1,
    unclassifiedDetected: 1,
    autoApprovedBySection: { steering: 1, exhaust: 1, wheels: 1 },
    newCandidatesBySection: { steering: 1, exhaust: 1, wheels: 1 },
    existingClassificationDrift: {
      sameCategory: 0,
      differentCategory: 0,
      noLongerMatches: 0,
    },
  });
});

test("PHASE 2D coverage separates HIGH, safe top-level, missing-rule and review", () => {
  const evaluations = [{
    productId: 1,
    article: "A0004600001",
    name: "Рейка рульова",
    numberFamily: "A",
    technicalEpc: ["46"],
    detectedTypeCodes: ["STEERING_RACK"],
    existingMemberships: [],
  }, {
    productId: 2,
    article: "A0004909999",
    name: "Деталь вихлопу",
    numberFamily: "A",
    technicalEpc: ["49"],
    detectedTypeCodes: [],
    existingMemberships: [],
  }, {
    productId: 3,
    article: "A6394030244",
    name: "Кришка запасного колеса",
    numberFamily: "A",
    technicalEpc: ["40"],
    detectedTypeCodes: ["WHEEL_SPARE_COVER"],
    existingMemberships: [],
  }, {
    productId: 4,
    article: "A0008800000",
    name: "Rubber exhaust hanger",
    numberFamily: "A",
    technicalEpc: ["88"],
    detectedTypeCodes: ["EXHAUST_MOUNT"],
    existingMemberships: [],
  }, {
    productId: 5,
    article: "A0004000000",
    name: "Cross-section signal",
    numberFamily: "A",
    technicalEpc: ["40"],
    detectedTypeCodes: ["WHEEL_CENTER_CAP", "EXHAUST_SENSOR"],
    existingMemberships: [],
  }, {
    productId: 6,
    article: "A0004900000",
    name: "Existing",
    numberFamily: "A",
    technicalEpc: ["49"],
    detectedTypeCodes: [],
    existingMemberships: [{
      parentSlug: "exhaust",
      approvalStatus: "AUTO_APPROVED",
    }],
  }, {
    productId: 7,
    article: "A2214600325",
    name: "GETRIEBE",
    numberFamily: "A",
    technicalEpc: ["46"],
    detectedTypeCodes: [],
    existingMemberships: [],
  }];
  const coverage = buildCustomerTaxonomyBatch2Coverage({
    evaluations,
    additions: [item("steering", {
      productId: 1,
      approvalStatus: "AUTO_APPROVED",
    })],
  });

  assert.deepEqual(coverage.summary.steering, {
    technicalTotal: 2,
    alreadyMember: 0,
    newHighProposal: 1,
    safeTopLevelPossible: 0,
    missingRule: 0,
    realReview: 1,
  });
  assert.deepEqual(coverage.summary.exhaust, {
    technicalTotal: 4,
    alreadyMember: 1,
    newHighProposal: 0,
    safeTopLevelPossible: 1,
    missingRule: 1,
    realReview: 1,
  });
  assert.deepEqual(coverage.summary.wheels, {
    technicalTotal: 2,
    alreadyMember: 0,
    newHighProposal: 0,
    safeTopLevelPossible: 1,
    missingRule: 0,
    realReview: 1,
  });
  assert.equal(coverage.safeTopLevel.some((row) => row.article === "A6394030244"), true);
});
