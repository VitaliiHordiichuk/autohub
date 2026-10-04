import { pool } from "../config/db.js";
import { CUSTOMER_TAXONOMY_PHASE2E_REVIEW } from "../data/CustomerTaxonomyPhase2EReview.js";
import { runCustomerTaxonomyPreview } from "./CustomerTaxonomyPreviewService.js";

export const CUSTOMER_TAXONOMY_PHASE2E_SECTIONS = Object.freeze([
  "transmission-drivetrain",
  "fuel-system",
  "cooling",
  "climate",
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

function countBy(items, field, values = CUSTOMER_TAXONOMY_PHASE2E_SECTIONS) {
  const counts = Object.fromEntries(values.map((value) => [value, 0]));
  for (const item of items) {
    const value = item?.[field];
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function detail(row, evaluation, extra = {}) {
  return {
    productId: evaluation?.productId ?? null,
    article: row.article,
    name: evaluation?.name ?? row.name ?? null,
    technicalEpc: evaluation?.technicalEpc || [row.epc],
    detectedTypeCodes: evaluation?.detectedTypeCodes || [],
    section: row.section,
    targetSection: row.targetSection || null,
    originalBucket: row.originalBucket,
    finalBucket: row.finalBucket,
    typeCode: row.typeCode || null,
    categorySlug: row.categorySlug || null,
    reason: row.reason,
    collision: row.collision || null,
    reviewSource: "PHASE_2E_AUDIT",
    ...extra,
  };
}

export function reviewedPhase2ERowForProduct(product = {}) {
  const groups = product.technicalEpcGroups ?? product.technical_epc_groups ?? [];
  const epcGroups = new Set((Array.isArray(groups) ? groups : [groups]).map(String));
  const article = normalizeArticle(
    product.articleNormalized ?? product.article_normalized ?? product.article,
  );
  return CUSTOMER_TAXONOMY_PHASE2E_REVIEW.find((row) => (
    row.article === article && epcGroups.has(row.epc)
  )) || null;
}

export function isReviewedPhase2ESafeTopLevel(product = {}, expectedSection = null) {
  const row = reviewedPhase2ERowForProduct(product);
  return Boolean(
    row
    && row.finalBucket === "SAFE_TOPLEVEL"
    && (!expectedSection || row.targetSection === expectedSection),
  );
}

export function buildCustomerTaxonomyPhase2ECoverage({
  evaluations = [],
  additions = [],
} = {}) {
  const evaluationByKey = new Map();
  for (const evaluation of evaluations) {
    for (const epc of evaluation.technicalEpc || []) {
      evaluationByKey.set(key(evaluation.article, epc), evaluation);
    }
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
    deferredToEngine: [],
    realReview: [],
    crossSectionAssignments: [],
    suspicious: [],
  };

  for (const row of CUSTOMER_TAXONOMY_PHASE2E_REVIEW) {
    const evaluation = evaluationByKey.get(key(row.article, row.epc));
    if (!evaluation) {
      buckets.suspicious.push(detail(row, null, { issue: "SOURCE_PRODUCT_MISSING" }));
      continue;
    }
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
        const high = detail(row, evaluation, {
          categoryId: matchingAddition.categoryId,
          ruleCode: matchingAddition.ruleCode,
          ruleVersion: matchingAddition.ruleVersion,
        });
        buckets.newHigh.push(high);
        if (row.section !== row.targetSection) buckets.crossSectionAssignments.push(high);
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
    if (row.finalBucket === "DEFER_TO_ENGINE") {
      buckets.deferredToEngine.push(detail(row, evaluation));
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
  const summary = {
    technicalTotal: CUSTOMER_TAXONOMY_PHASE2E_REVIEW.length,
    sourceProductsFound: CUSTOMER_TAXONOMY_PHASE2E_REVIEW.length - missingSourceProducts,
    alreadyMember: buckets.alreadyMember.length,
    newHigh: buckets.newHigh.length,
    safeTopLevel: buckets.safeTopLevel.length,
    missingRuleRemaining: buckets.missingRuleRemaining.length,
    deferredToEngine: buckets.deferredToEngine.length,
    realReview: buckets.realReview.length,
    crossSectionAssignments: buckets.crossSectionAssignments.length,
    suspicious: buckets.suspicious.length,
    bySection: Object.fromEntries(CUSTOMER_TAXONOMY_PHASE2E_SECTIONS.map((section) => {
      const inSection = (items) => items.filter((item) => item.section === section).length;
      return [section, {
        technicalTotal: CUSTOMER_TAXONOMY_PHASE2E_REVIEW.filter((row) => row.section === section).length,
        alreadyMember: inSection(buckets.alreadyMember),
        newHigh: inSection(buckets.newHigh),
        safeTopLevel: inSection(buckets.safeTopLevel),
        missingRuleRemaining: inSection(buckets.missingRuleRemaining),
        deferredToEngine: inSection(buckets.deferredToEngine),
        realReview: inSection(buckets.realReview),
      }];
    })),
    highByLeaf: countBy(buckets.newHigh, "categorySlug", [
      ...new Set(buckets.newHigh.map((item) => item.categorySlug).filter(Boolean)),
    ]),
  };

  return { summary, ...buckets };
}

export function buildCustomerTaxonomyPhase2EReport(report) {
  const coverage = buildCustomerTaxonomyPhase2ECoverage({
    evaluations: report.evaluations || [],
    additions: report.additions || [],
  });
  return {
    mode: report.mode,
    batch: "PHASE_2E",
    detectorVersion: 5,
    summary: {
      ...coverage.summary,
      existingMemberships: report.summary.existingMemberships,
      existingClassificationDrift: report.summary.classificationDrift,
    },
    coverage,
  };
}

export async function runCustomerTaxonomyPhase2EPreview({ dbPool = pool } = {}) {
  const report = await runCustomerTaxonomyPreview({
    dbPool,
    includeEvaluations: true,
  });
  return buildCustomerTaxonomyPhase2EReport(report);
}

export const CustomerTaxonomyPhase2EPreviewService = {
  run: runCustomerTaxonomyPhase2EPreview,
};
