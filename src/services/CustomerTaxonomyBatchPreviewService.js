import { pool } from "../config/db.js";
import { runCustomerTaxonomyPreview } from "./CustomerTaxonomyPreviewService.js";

export const CUSTOMER_TAXONOMY_BATCH2_SECTIONS = Object.freeze([
  "steering",
  "exhaust",
  "wheels",
]);

const batch2Sections = new Set(CUSTOMER_TAXONOMY_BATCH2_SECTIONS);
const batch2TypePrefixes = Object.freeze([
  "STEERING_",
  "EXHAUST_",
  "WHEEL_",
  "TPMS_",
]);

function belongsToBatch2(item) {
  return batch2Sections.has(item?.parentSlug);
}

function conflictBelongsToBatch2(item) {
  return item?.conflicts?.some((conflict) => (
    conflict?.candidates?.some((candidate) => (
      batch2Sections.has(candidate?.category?.parentSlug)
    ))
  ));
}

function hasBatch2Type(item) {
  return item?.detectedTypeCodes?.some((typeCode) => (
    batch2TypePrefixes.some((prefix) => typeCode.startsWith(prefix))
  ));
}

function countBy(items, key) {
  const counts = Object.fromEntries(CUSTOMER_TAXONOMY_BATCH2_SECTIONS.map((section) => (
    [section, 0]
  )));
  for (const item of items) {
    const value = item?.[key];
    if (Object.hasOwn(counts, value)) counts[value] += 1;
  }
  return counts;
}

export function buildCustomerTaxonomyBatch2Report(report) {
  const autoApproved = report.autoApproved.filter(belongsToBatch2);
  const additions = report.additions.filter((item) => (
    belongsToBatch2(item) && item.approvalStatus === "AUTO_APPROVED"
  ));
  const review = report.review.filter(belongsToBatch2);
  const conflicts = report.conflicts.filter(conflictBelongsToBatch2);
  const unclassified = report.unclassified.filter(hasBatch2Type);
  const existingMemberships = report.summary.existingMemberships;

  return {
    mode: report.mode,
    batch: "PHASE_2D",
    sections: [...CUSTOMER_TAXONOMY_BATCH2_SECTIONS],
    summary: {
      existingMemberships,
      newBatchCandidates: additions.length,
      futureTotalMemberships: existingMemberships + additions.length,
      autoApproved: autoApproved.length,
      review: review.length,
      conflicts: conflicts.length,
      unclassifiedDetected: unclassified.length,
      autoApprovedBySection: countBy(autoApproved, "parentSlug"),
      newCandidatesBySection: countBy(additions, "parentSlug"),
      existingClassificationDrift: report.summary.classificationDrift || {
        sameCategory: 0,
        differentCategory: 0,
        noLongerMatches: 0,
      },
    },
    additions,
    autoApproved,
    review,
    conflicts,
    unclassified,
  };
}

export async function runCustomerTaxonomyBatch2Preview({ dbPool = pool } = {}) {
  const report = await runCustomerTaxonomyPreview({ dbPool });
  return buildCustomerTaxonomyBatch2Report(report);
}

export const CustomerTaxonomyBatchPreviewService = {
  run: runCustomerTaxonomyBatch2Preview,
};
