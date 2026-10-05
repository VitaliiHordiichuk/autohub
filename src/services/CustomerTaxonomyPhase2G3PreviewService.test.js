import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_TAXONOMY_PHASE2G3_REVIEW,
  CUSTOMER_TAXONOMY_PHASE2G3_SUPPLEMENTARY_REVIEW,
} from "../data/CustomerTaxonomyPhase2G3Review.js";
import { buildCustomerTaxonomyPhase2G3Coverage } from "./CustomerTaxonomyPhase2G3PreviewService.js";

function acceptedAuditFixture() {
  const allRows = [
    ...CUSTOMER_TAXONOMY_PHASE2G3_REVIEW,
    ...CUSTOMER_TAXONOMY_PHASE2G3_SUPPLEMENTARY_REVIEW,
  ];
  const evaluations = allRows.map((row, index) => ({
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
  const additions = CUSTOMER_TAXONOMY_PHASE2G3_REVIEW
    .map((row, index) => ({ row, productId: index + 1 }))
    .filter(({ row }) => row.finalBucket === "HIGH")
    .map(({ row, productId }) => ({
      productId,
      categoryId: productId + 50000,
      categorySlug: row.categorySlug,
      approvalStatus: "AUTO_APPROVED",
      assignmentSource: "RULE",
      ruleCode: `${row.typeCode}_PHASE2G3_V1`,
      ruleVersion: 1,
    }));
  return { evaluations, additions };
}

test("accepted PHASE 2G.3 audit reconciles all 1964 unique Fasteners products", () => {
  const coverage = buildCustomerTaxonomyPhase2G3Coverage(acceptedAuditFixture());
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
    technicalTotal: 1964,
    sourceProductsFound: 1964,
    alreadyMember: 247,
    newHigh: 1208,
    safeTopLevel: 289,
    missingRuleRemaining: 0,
    realReview: 220,
    suspicious: 0,
  });
  assert.equal(new Set(CUSTOMER_TAXONOMY_PHASE2G3_REVIEW.map((row) => row.article)).size, 1964);
});

test("PHASE 2G.3 resolves all 271 MISSING rules without promoting REVIEW", () => {
  const coverage = buildCustomerTaxonomyPhase2G3Coverage(acceptedAuditFixture());
  assert.deepEqual(coverage.summary.reconciliation, {
    originalHigh: { finalHigh: 937, finalSafe: 0, finalReview: 0 },
    originalSafe: { finalSafe: 289, finalHigh: 0, finalReview: 0 },
    originalMissing: { finalHigh: 271, finalSafe: 0, finalReview: 0 },
    originalReview: { unchanged: 220, promotedHigh: 0, promotedSafe: 0 },
    alreadyMemberProtected: 247,
  });
  assert.equal(coverage.newHigh.filter((row) => row.originalBucket === "MISSING_RULE").length, 271);
  assert.equal(coverage.realReview.every((row) => row.finalBucket === "REAL_REVIEW"), true);
});

test("PHASE 2G.3 creates exactly the 12 approved Fasteners leaves", () => {
  const coverage = buildCustomerTaxonomyPhase2G3Coverage(acceptedAuditFixture());
  assert.deepEqual(coverage.summary.highByLeaf, {
    "fasteners-bolts": 278,
    "fasteners-clamps": 108,
    "fasteners-clips-rivets": 78,
    "fasteners-grommets": 16,
    "fasteners-nuts": 154,
    "fasteners-pins-circlips": 3,
    "fasteners-plugs-caps": 47,
    "fasteners-screws": 202,
    "fasteners-sealing-rings": 4,
    "fasteners-seals-gaskets": 274,
    "fasteners-studs": 3,
    "fasteners-washers": 41,
  });
  assert.equal(new Set(coverage.newHigh.map((item) => item.categorySlug)).size, 12);
});

test("supplementary historical backlog remains separate and SAFE_TOPLEVEL only", () => {
  const coverage = buildCustomerTaxonomyPhase2G3Coverage(acceptedAuditFixture());
  assert.deepEqual(coverage.summary.supplementaryBacklog.details.map((item) => ({
    article: item.article,
    status: item.status,
    finalBucket: item.finalBucket,
  })), [
    { article: "A2033200056", status: "SAFE_TOPLEVEL", finalBucket: "SAFE_TOPLEVEL" },
    { article: "A246324290464", status: "SAFE_TOPLEVEL", finalBucket: "SAFE_TOPLEVEL" },
  ]);
  assert.equal(coverage.summary.supplementaryBacklog.safeTopLevel, 2);
  assert.equal(coverage.summary.technicalTotal, 1964);
  assert.equal(coverage.safeTopLevel.length, 289);
  assert.equal(coverage.supplementarySafeTopLevel.length, 2);
});

test("PHASE 2G.3 collision report preserves every reviewed cross-section decision", () => {
  const coverage = buildCustomerTaxonomyPhase2G3Coverage(acceptedAuditFixture());
  assert.deepEqual(coverage.summary.collisionBreakdown, {
    "Fasteners ↔ Suspension": 24,
    "Fasteners ↔ body-glass": 50,
    "Fasteners ↔ brakes": 18,
    "Fasteners ↔ climate": 4,
    "Fasteners ↔ cooling": 37,
    "Fasteners ↔ electrical-electronics-lighting": 29,
    "Fasteners ↔ engine": 135,
    "Fasteners ↔ exhaust": 103,
    "Fasteners ↔ fuel-system": 9,
    "Fasteners ↔ interior-safety": 6,
    "Fasteners ↔ steering": 9,
    "Fasteners ↔ suspension": 22,
    "Fasteners ↔ transmission-drivetrain": 38,
    "Fasteners ↔ wheels": 4,
  });
});
