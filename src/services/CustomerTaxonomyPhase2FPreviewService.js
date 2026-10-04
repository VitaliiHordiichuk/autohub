import { pool } from "../config/db.js";
import { CUSTOMER_TAXONOMY_PHASE2F_REVIEW } from "../data/CustomerTaxonomyPhase2FReview.js";
import { runCustomerTaxonomyPreview } from "./CustomerTaxonomyPreviewService.js";

export const CUSTOMER_TAXONOMY_PHASE2F_SECTIONS = Object.freeze([
  "engine",
  "suspension",
]);

const approvedStatuses = new Set(["AUTO_APPROVED", "MANUAL_APPROVED"]);

function normalizeArticle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function key(article, epc) {
  return `${normalizeArticle(article)}:${String(epc || "").trim().toUpperCase()}`;
}

function countBy(items, field) {
  const result = {};
  for (const item of items) {
    const value = item?.[field];
    if (!value) continue;
    result[value] = (result[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function detail(row, evaluation, extra = {}) {
  return {
    productId: evaluation?.productId ?? null,
    article: row.article,
    name: evaluation?.name ?? row.name ?? null,
    technicalEpc: evaluation?.technicalEpc || (row.epc ? [row.epc] : []),
    detectedTypeCodes: evaluation?.detectedTypeCodes || [],
    section: row.section,
    targetSection: row.targetSection || null,
    originalBucket: row.originalBucket,
    finalBucket: row.finalBucket,
    typeCode: row.typeCode || null,
    categorySlug: row.categorySlug || null,
    reason: row.reason,
    collision: row.collision || null,
    deferredFromPhase2E: row.deferredFromPhase2E === true,
    reviewSource: "PHASE_2F_AUDIT",
    ...extra,
  };
}

export function reviewedPhase2FRowForProduct(product = {}) {
  const rawGroups = product.technicalEpcGroups ?? product.technical_epc_groups ?? [];
  const groups = (Array.isArray(rawGroups) ? rawGroups : [rawGroups])
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);
  if (!groups.length) groups.push("");
  const article = normalizeArticle(
    product.articleNormalized ?? product.article_normalized ?? product.article,
  );
  return CUSTOMER_TAXONOMY_PHASE2F_REVIEW.find((row) => (
    row.article === article && groups.includes(row.epc)
  )) || null;
}

export function isReviewedPhase2FSafeTopLevel(product = {}, expectedSection = null) {
  const row = reviewedPhase2FRowForProduct(product);
  return Boolean(
    row
    && row.finalBucket === "SAFE_TOPLEVEL"
    && (!expectedSection || row.targetSection === expectedSection),
  );
}

function buildReconciliation() {
  const transition = (originalBucket, finalBucket) => CUSTOMER_TAXONOMY_PHASE2F_REVIEW
    .filter((row) => row.originalBucket === originalBucket && row.finalBucket === finalBucket)
    .length;
  return {
    originalHigh: {
      finalHigh: transition("HIGH", "HIGH"),
      finalReview: transition("HIGH", "REAL_REVIEW"),
    },
    originalSafe: {
      finalSafe: transition("SAFE_TOPLEVEL", "SAFE_TOPLEVEL"),
      finalHigh: transition("SAFE_TOPLEVEL", "HIGH"),
      finalReview: transition("SAFE_TOPLEVEL", "REAL_REVIEW"),
    },
    originalMissingRule: {
      finalHigh: transition("MISSING_RULE", "HIGH"),
      finalSafe: transition("MISSING_RULE", "SAFE_TOPLEVEL"),
      finalReview: transition("MISSING_RULE", "REAL_REVIEW"),
    },
    originalReview: {
      unchanged: transition("REAL_REVIEW", "REAL_REVIEW"),
      promotedHigh: transition("REAL_REVIEW", "HIGH"),
      promotedSafe: transition("REAL_REVIEW", "SAFE_TOPLEVEL"),
    },
    alreadyMemberProtected: CUSTOMER_TAXONOMY_PHASE2F_REVIEW.filter((row) => (
      row.originalBucket === "ALREADY_MEMBER" && row.finalBucket === "ALREADY_MEMBER"
    )).length,
  };
}

export function buildCustomerTaxonomyPhase2FCoverage({ evaluations = [], additions = [] } = {}) {
  const evaluationByKey = new Map();
  for (const evaluation of evaluations) {
    const groups = evaluation.technicalEpc?.length ? evaluation.technicalEpc : [""];
    for (const epc of groups) evaluationByKey.set(key(evaluation.article, epc), evaluation);
  }
  const additionsByProduct = new Map();
  for (const addition of additions) {
    const list = additionsByProduct.get(addition.productId) || [];
    list.push(addition);
    additionsByProduct.set(addition.productId, list);
  }

  const buckets = {
    alreadyMember: [],
    newHigh: [],
    safeTopLevel: [],
    missingRuleRemaining: [],
    realReview: [],
    crossSectionAssignments: [],
    deferredFromPhase2E: [],
    suspicious: [],
  };

  for (const row of CUSTOMER_TAXONOMY_PHASE2F_REVIEW) {
    const evaluation = evaluationByKey.get(key(row.article, row.epc));
    if (!evaluation) {
      buckets.suspicious.push(detail(row, null, { issue: "SOURCE_PRODUCT_MISSING" }));
      continue;
    }
    if (row.collision) buckets.crossSectionAssignments.push(detail(row, evaluation));
    if (row.deferredFromPhase2E) buckets.deferredFromPhase2E.push(detail(row, evaluation));

    const approvedMembership = (evaluation.existingMemberships || []).find((membership) => (
      membership.isPrimary && approvedStatuses.has(membership.approvalStatus)
    ));
    if (approvedMembership) {
      buckets.alreadyMember.push(detail(row, evaluation, {
        actualCategorySlug: approvedMembership.categorySlug,
        actualParentSlug: approvedMembership.parentSlug,
      }));
      continue;
    }
    if (row.originalBucket === "ALREADY_MEMBER") {
      buckets.suspicious.push(detail(row, evaluation, {
        issue: "AUDIT_BASELINE_MEMBERSHIP_MISSING",
      }));
      continue;
    }
    if (row.finalBucket === "HIGH") {
      const matchingAddition = (additionsByProduct.get(evaluation.productId) || []).find((item) => (
        item.categorySlug === row.categorySlug
        && item.approvalStatus === "AUTO_APPROVED"
        && item.assignmentSource === "RULE"
      ));
      if (matchingAddition) {
        buckets.newHigh.push(detail(row, evaluation, {
          categoryId: matchingAddition.categoryId,
          ruleCode: matchingAddition.ruleCode,
          ruleVersion: matchingAddition.ruleVersion,
        }));
      } else {
        buckets.missingRuleRemaining.push(detail(row, evaluation, {
          issue: "EXPECTED_HIGH_RULE_DID_NOT_RESOLVE",
        }));
      }
      continue;
    }
    if (row.finalBucket === "SAFE_TOPLEVEL") {
      buckets.safeTopLevel.push(detail(row, evaluation));
      continue;
    }
    if (row.finalBucket === "REAL_REVIEW") {
      buckets.realReview.push(detail(row, evaluation));
      continue;
    }
    buckets.suspicious.push(detail(row, evaluation, { issue: "UNKNOWN_FINAL_BUCKET" }));
  }

  const missingSourceProducts = buckets.suspicious.filter((item) => (
    item.issue === "SOURCE_PRODUCT_MISSING"
  )).length;
  const deferredHigh = buckets.deferredFromPhase2E.filter((item) => item.finalBucket === "HIGH");
  const deferredSafe = buckets.deferredFromPhase2E.filter((item) => (
    item.finalBucket === "SAFE_TOPLEVEL"
  ));
  const deferredReview = buckets.deferredFromPhase2E.filter((item) => (
    item.finalBucket === "REAL_REVIEW"
  ));
  const summary = {
    technicalTotal: CUSTOMER_TAXONOMY_PHASE2F_REVIEW.length,
    sourceProductsFound: CUSTOMER_TAXONOMY_PHASE2F_REVIEW.length - missingSourceProducts,
    alreadyMember: buckets.alreadyMember.length,
    newHigh: buckets.newHigh.length,
    safeTopLevel: buckets.safeTopLevel.length,
    missingRuleRemaining: buckets.missingRuleRemaining.length,
    realReview: buckets.realReview.length,
    crossSectionAssignments: buckets.crossSectionAssignments.length,
    suspicious: buckets.suspicious.length,
    bySection: Object.fromEntries(CUSTOMER_TAXONOMY_PHASE2F_SECTIONS.map((section) => {
      const inSection = (items) => items.filter((item) => item.section === section).length;
      return [section, {
        technicalTotal: CUSTOMER_TAXONOMY_PHASE2F_REVIEW.filter((row) => row.section === section).length,
        alreadyMember: inSection(buckets.alreadyMember),
        newHigh: inSection(buckets.newHigh),
        safeTopLevel: inSection(buckets.safeTopLevel),
        missingRuleRemaining: inSection(buckets.missingRuleRemaining),
        realReview: inSection(buckets.realReview),
      }];
    })),
    highByLeaf: countBy(buckets.newHigh, "categorySlug"),
    reconciliation: buildReconciliation(),
    deferredFromPhase2E: {
      total: buckets.deferredFromPhase2E.length,
      high: deferredHigh.length,
      safeTopLevel: deferredSafe.length,
      realReview: deferredReview.length,
      highByLeaf: countBy(deferredHigh, "categorySlug"),
    },
  };
  return { summary, ...buckets };
}

export function buildCustomerTaxonomyPhase2FReport(report) {
  const coverage = buildCustomerTaxonomyPhase2FCoverage({
    evaluations: report.evaluations || [],
    additions: report.additions || [],
  });
  return {
    mode: report.mode,
    batch: "PHASE_2F",
    detectorVersion: 6,
    summary: {
      ...coverage.summary,
      existingMemberships: report.summary.existingMemberships,
      existingClassificationDrift: report.summary.classificationDrift,
    },
    coverage,
  };
}

export async function runCustomerTaxonomyPhase2FPreview({ dbPool = pool } = {}) {
  const report = await runCustomerTaxonomyPreview({ dbPool, includeEvaluations: true });
  return buildCustomerTaxonomyPhase2FReport(report);
}

export const CustomerTaxonomyPhase2FPreviewService = {
  run: runCustomerTaxonomyPhase2FPreview,
};
