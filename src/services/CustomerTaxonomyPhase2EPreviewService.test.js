import test from "node:test";
import assert from "node:assert/strict";

import { CUSTOMER_TAXONOMY_PHASE2E_REVIEW } from "../data/CustomerTaxonomyPhase2EReview.js";
import { buildCustomerTaxonomyPhase2ECoverage } from "./CustomerTaxonomyPhase2EPreviewService.js";

function buildAcceptedAuditFixture() {
  const evaluations = CUSTOMER_TAXONOMY_PHASE2E_REVIEW.map((row, index) => ({
    productId: index + 1,
    article: row.article,
    name: `Reviewed ${row.article}`,
    technicalEpc: [row.epc],
    detectedTypeCodes: row.typeCode ? [row.typeCode] : [],
    existingMemberships: row.originalBucket === "ALREADY_MEMBER" ? [{
      isPrimary: true,
      approvalStatus: "AUTO_APPROVED",
      categorySlug: row.categorySlug,
      parentSlug: row.targetSection,
    }] : [],
  }));
  const additions = CUSTOMER_TAXONOMY_PHASE2E_REVIEW
    .map((row, index) => ({ row, productId: index + 1 }))
    .filter(({ row }) => row.finalBucket === "HIGH")
    .map(({ row, productId }) => ({
      productId,
      categoryId: productId + 10000,
      categorySlug: row.categorySlug,
      approvalStatus: "AUTO_APPROVED",
      assignmentSource: "RULE",
      ruleCode: `${row.typeCode}_A_EPC${row.epc}_PHASE2E_V1`,
      ruleVersion: 1,
    }));
  return { evaluations, additions };
}

test("accepted PHASE 2E audit reconciles all 620 products without broad EPC inference", () => {
  const coverage = buildCustomerTaxonomyPhase2ECoverage(buildAcceptedAuditFixture());
  assert.deepEqual({
    technicalTotal: coverage.summary.technicalTotal,
    sourceProductsFound: coverage.summary.sourceProductsFound,
    alreadyMember: coverage.summary.alreadyMember,
    newHigh: coverage.summary.newHigh,
    safeTopLevel: coverage.summary.safeTopLevel,
    missingRuleRemaining: coverage.summary.missingRuleRemaining,
    deferredToEngine: coverage.summary.deferredToEngine,
    realReview: coverage.summary.realReview,
    crossSectionAssignments: coverage.summary.crossSectionAssignments,
    suspicious: coverage.summary.suspicious,
  }, {
    technicalTotal: 620,
    sourceProductsFound: 620,
    alreadyMember: 72,
    newHigh: 226,
    safeTopLevel: 216,
    missingRuleRemaining: 0,
    deferredToEngine: 52,
    realReview: 54,
    crossSectionAssignments: 16,
    suspicious: 0,
  });
  assert.deepEqual(coverage.summary.bySection, {
    "transmission-drivetrain": {
      technicalTotal: 119,
      alreadyMember: 0,
      newHigh: 62,
      safeTopLevel: 56,
      missingRuleRemaining: 0,
      deferredToEngine: 0,
      realReview: 1,
    },
    "fuel-system": {
      technicalTotal: 152,
      alreadyMember: 6,
      newHigh: 58,
      safeTopLevel: 57,
      missingRuleRemaining: 0,
      deferredToEngine: 0,
      realReview: 31,
    },
    cooling: {
      technicalTotal: 231,
      alreadyMember: 0,
      newHigh: 86,
      safeTopLevel: 85,
      missingRuleRemaining: 0,
      deferredToEngine: 52,
      realReview: 8,
    },
    climate: {
      technicalTotal: 118,
      alreadyMember: 66,
      newHigh: 20,
      safeTopLevel: 18,
      missingRuleRemaining: 0,
      deferredToEngine: 0,
      realReview: 14,
    },
  });
});

test("review, deferred belt-drive and reviewed cross-section decisions never become SAFE fallback", () => {
  const coverage = buildCustomerTaxonomyPhase2ECoverage(buildAcceptedAuditFixture());
  assert.equal(coverage.realReview.length, 54);
  assert.equal(coverage.deferredToEngine.length, 52);
  assert.ok(coverage.deferredToEngine.every((item) => (
    item.typeCode === "ENGINE_BELT_DRIVE_COMPONENT"
    && item.section === "cooling"
    && item.targetSection === "engine"
  )));
  assert.ok(coverage.safeTopLevel.every((item) => (
    item.reviewSource === "PHASE_2E_AUDIT"
    && item.finalBucket === "SAFE_TOPLEVEL"
  )));
  assert.equal(coverage.crossSectionAssignments.filter((item) => (
    item.typeCode === "ADBLUE_SCR_COMPONENT"
    && item.categorySlug === "exhaust-adblue-scr"
  )).length, 8);
  assert.equal(coverage.crossSectionAssignments.filter((item) => (
    item.typeCode === "FILTER_CABIN_KIT"
    && item.categorySlug === "filters-cabin"
  )).length, 1);
});
