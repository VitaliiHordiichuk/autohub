import test from "node:test";
import assert from "node:assert/strict";

import { buildCustomerTaxonomyBatch2Report } from "./CustomerTaxonomyBatchPreviewService.js";

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
