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
const approvedStatuses = new Set(["AUTO_APPROVED", "MANUAL_APPROVED"]);
const dedicatedEpcBySection = Object.freeze({
  steering: "46",
  exhaust: "49",
  wheels: "40",
});
const realReviewNameBySection = Object.freeze({
  steering: /(?:коробк.*передач|\bgetriebe\b|замк.*запал)/iu,
  exhaust: /^акцент$/iu,
  wheels: /(?:золотник[\s-]*датчик|фр[іи]кц[іи]йне\s+колесо)/iu,
});

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

function typeSection(typeCode) {
  if (typeCode.startsWith("STEERING_")) return "steering";
  if (typeCode.startsWith("EXHAUST_")) return "exhaust";
  if (typeCode.startsWith("WHEEL_") || typeCode.startsWith("TPMS_")) {
    return "wheels";
  }
  return null;
}

function evaluationSections(evaluation) {
  const sections = new Set();
  for (const typeCode of evaluation.detectedTypeCodes || []) {
    const section = typeSection(typeCode);
    if (section) sections.add(section);
  }
  const epc = new Set((evaluation.technicalEpc || []).map(String));
  for (const section of CUSTOMER_TAXONOMY_BATCH2_SECTIONS) {
    if (epc.has(dedicatedEpcBySection[section])) sections.add(section);
  }
  for (const membership of evaluation.existingMemberships || []) {
    if (batch2Sections.has(membership.parentSlug)) sections.add(membership.parentSlug);
  }
  return sections;
}

function coverageDetail(evaluation, section, reason) {
  return {
    productId: evaluation.productId,
    article: evaluation.article,
    name: evaluation.name,
    technicalEpc: evaluation.technicalEpc || [],
    detectedTypeCodes: (evaluation.detectedTypeCodes || []).filter((typeCode) => (
      typeSection(typeCode) === section
    )),
    section,
    reason,
  };
}

export function buildCustomerTaxonomyBatch2Coverage({ evaluations = [], additions = [] } = {}) {
  const newHigh = new Set(
    additions
      .filter((item) => (
        batch2Sections.has(item.parentSlug)
        && item.approvalStatus === "AUTO_APPROVED"
      ))
      .map((item) => `${item.productId}:${item.parentSlug}`),
  );
  const rows = [];

  for (const evaluation of evaluations) {
    if (evaluation.numberFamily !== "A") continue;
    const sections = evaluationSections(evaluation);
    for (const section of sections) {
      const key = `${evaluation.productId}:${section}`;
      const hasExisting = (evaluation.existingMemberships || []).some((membership) => (
        membership.parentSlug === section
        && approvedStatuses.has(membership.approvalStatus)
      ));
      if (hasExisting) {
        rows.push({
          bucket: "ALREADY_MEMBER",
          ...coverageDetail(evaluation, section, "Approved customer membership already exists"),
        });
        continue;
      }
      if (newHigh.has(key)) {
        rows.push({
          bucket: "NEW_HIGH_PROPOSAL",
          ...coverageDetail(evaluation, section, "Reviewed HIGH rule proposes a new membership"),
        });
        continue;
      }

      const sectionTypes = (evaluation.detectedTypeCodes || []).filter((typeCode) => (
        typeSection(typeCode) === section
      ));
      const epc = new Set((evaluation.technicalEpc || []).map(String));
      const crossSectionSignals = sections.size > 1;
      const nameRequiresReview = realReviewNameBySection[section].test(
        String(evaluation.name || "").trim(),
      );
      if (crossSectionSignals || nameRequiresReview) {
        rows.push({
          bucket: "REAL_REVIEW",
          ...coverageDetail(
            evaluation,
            section,
            crossSectionSignals
              ? "Signals span more than one customer section"
              : "Product name conflicts with the technical top-level context",
          ),
        });
      } else if (section === "wheels" && sectionTypes.includes("WHEEL_SPARE_COVER")) {
        rows.push({
          bucket: "SAFE_TOPLEVEL",
          ...coverageDetail(evaluation, section, "Spare-wheel cover is safely Wheels, but has no approved narrow leaf"),
        });
      } else if (sectionTypes.length) {
        rows.push({
          bucket: "MISSING_RULE",
          ...coverageDetail(evaluation, section, "Closed semantic TYPE_CODE has no reviewed matching rule"),
        });
      } else if (epc.has(dedicatedEpcBySection[section])) {
        rows.push({
          bucket: "SAFE_TOPLEVEL",
          ...coverageDetail(evaluation, section, "Dedicated EPC context proves the top level, not a narrow leaf"),
        });
      } else {
        rows.push({
          bucket: "REAL_REVIEW",
          ...coverageDetail(evaluation, section, "Section signal is not sufficient for automatic top-level assignment"),
        });
      }
    }
  }

  const summary = Object.fromEntries(CUSTOMER_TAXONOMY_BATCH2_SECTIONS.map((section) => {
    const sectionRows = rows.filter((row) => row.section === section);
    const count = (bucket) => sectionRows.filter((row) => row.bucket === bucket).length;
    return [section, {
      technicalTotal: sectionRows.length,
      alreadyMember: count("ALREADY_MEMBER"),
      newHighProposal: count("NEW_HIGH_PROPOSAL"),
      safeTopLevelPossible: count("SAFE_TOPLEVEL"),
      missingRule: count("MISSING_RULE"),
      realReview: count("REAL_REVIEW"),
    }];
  }));

  return {
    summary,
    safeTopLevel: rows.filter((row) => row.bucket === "SAFE_TOPLEVEL"),
    missingRule: rows.filter((row) => row.bucket === "MISSING_RULE"),
    realReview: rows.filter((row) => row.bucket === "REAL_REVIEW"),
  };
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
  const coverage = buildCustomerTaxonomyBatch2Coverage({
    evaluations: report.evaluations || [],
    additions,
  });

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
    coverage,
  };
}

export async function runCustomerTaxonomyBatch2Preview({ dbPool = pool } = {}) {
  const report = await runCustomerTaxonomyPreview({
    dbPool,
    includeEvaluations: true,
  });
  return buildCustomerTaxonomyBatch2Report(report);
}

export const CustomerTaxonomyBatchPreviewService = {
  run: runCustomerTaxonomyBatch2Preview,
};
