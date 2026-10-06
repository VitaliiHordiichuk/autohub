import { pool } from "../config/db.js";
import { CustomerTaxonomyRepository } from "../repositories/CustomerTaxonomyRepository.js";
import { CustomerTaxonomyAssignmentService } from "./CustomerTaxonomyAssignmentService.js";
import {
  buildCustomerTaxonomyBatch2Coverage,
  CUSTOMER_TAXONOMY_BATCH2_SECTIONS,
} from "./CustomerTaxonomyBatchPreviewService.js";
import { buildCustomerTaxonomyPreview } from "./CustomerTaxonomyPreviewService.js";
import {
  buildCustomerTaxonomyPhase2ECoverage,
  CUSTOMER_TAXONOMY_PHASE2E_SECTIONS,
  isReviewedPhase2ESafeTopLevel,
} from "./CustomerTaxonomyPhase2EPreviewService.js";
import {
  buildCustomerTaxonomyPhase2FCoverage,
  CUSTOMER_TAXONOMY_PHASE2F_SECTIONS,
  isReviewedPhase2FSafeTopLevel,
} from "./CustomerTaxonomyPhase2FPreviewService.js";
import {
  buildCustomerTaxonomyPhase2G1Coverage,
  CUSTOMER_TAXONOMY_PHASE2G1_SECTIONS,
  isReviewedPhase2G1SafeTopLevel,
} from "./CustomerTaxonomyPhase2G1PreviewService.js";
import {
  buildCustomerTaxonomyPhase2G2Coverage,
  CUSTOMER_TAXONOMY_PHASE2G2_SECTIONS,
  isReviewedPhase2G2SafeTopLevel,
} from "./CustomerTaxonomyPhase2G2PreviewService.js";
import {
  buildCustomerTaxonomyPhase2G3Coverage,
  CUSTOMER_TAXONOMY_PHASE2G3_SECTIONS,
  isReviewedPhase2G3SafeTopLevel,
} from "./CustomerTaxonomyPhase2G3PreviewService.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_ASSIGNMENT_SOURCE,
  CUSTOMER_TAXONOMY_DECISION,
  evaluateExistingApprovedPrimary,
} from "./CustomerTaxonomyResolver.js";
import { CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION } from "./CustomerProductTypeDetector.js";

export const CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION = "AUTO_APPROVED_ONLY";
export const CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION = "SAFE_TOPLEVEL_EPC_FALLBACK";

export class CustomerTaxonomyBackfillError extends Error {
  constructor(message, report = null) {
    super(message);
    this.name = "CustomerTaxonomyBackfillError";
    this.report = report;
  }
}

export function parseCustomerTaxonomyBackfillArguments(argumentsList = []) {
  let mode = "DRY_RUN";
  let expectedCount = null;
  let confirmation = null;
  let includeSafeTopLevel = false;

  for (const argument of argumentsList) {
    if (argument === "--apply") {
      if (mode === "VERIFY") throw new Error("--apply and --verify cannot be combined");
      mode = "APPLY";
      continue;
    }
    if (argument === "--verify") {
      if (mode === "APPLY") throw new Error("--apply and --verify cannot be combined");
      mode = "VERIFY";
      continue;
    }
    if (argument === "--include-safe-top-level") {
      includeSafeTopLevel = true;
      continue;
    }
    if (argument.startsWith("--confirm=")) {
      confirmation = argument.slice("--confirm=".length);
      continue;
    }
    if (argument.startsWith("--expected-count=")) {
      const raw = argument.slice("--expected-count=".length);
      if (!/^\d+$/.test(raw)) throw new Error("--expected-count must be a non-negative integer");
      expectedCount = Number(raw);
      if (!Number.isSafeInteger(expectedCount)) {
        throw new Error("--expected-count is outside the safe integer range");
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  const requiredConfirmation = includeSafeTopLevel
    ? CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION
    : CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION;
  if (mode === "APPLY" && confirmation !== requiredConfirmation) {
    throw new Error(
      `--apply requires --confirm=${requiredConfirmation}`,
    );
  }
  return {
    mode,
    expectedCount,
    confirmation,
    includeSafeTopLevel,
  };
}

function membershipKey(productId, categoryId) {
  return `${productId}:${categoryId}`;
}

function ruleKey(code, version) {
  return `${code}:${version}`;
}

function buildBreakdown(candidates) {
  const sections = {
    "filters-maintenance": 0,
    brakes: 0,
    accessories: 0,
    steering: 0,
    exhaust: 0,
    wheels: 0,
    engine: 0,
    suspension: 0,
    "electrical-electronics-lighting": 0,
    "fasteners-seals-standard-parts": 0,
  };
  const leaves = {};
  for (const candidate of candidates) {
    const section = candidate.sectionSlug || candidate.parentSlug || candidate.categorySlug;
    sections[section] = (sections[section] || 0) + 1;
    leaves[candidate.categorySlug] = (leaves[candidate.categorySlug] || 0) + 1;
  }
  return {
    sections,
    leaves: Object.fromEntries(Object.entries(leaves).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function desiredMembership(candidate) {
  return {
    productId: candidate.productId,
    customerCategoryId: candidate.categoryId,
    isPrimary: true,
    assignmentSource: candidate.assignmentSource,
    assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
    ruleCode: candidate.ruleCode ?? null,
    ruleVersion: candidate.ruleVersion ?? null,
    confidence: candidate.confidence,
    approvalStatus: candidate.approvalStatus,
  };
}

function exactDesiredMembership(membership, desired) {
  return Boolean(membership)
    && membership.productId === desired.productId
    && membership.customerCategoryId === desired.customerCategoryId
    && membership.isPrimary === desired.isPrimary
    && membership.assignmentSource === desired.assignmentSource
    && membership.assignmentOrigin === desired.assignmentOrigin
    && membership.ruleCode === desired.ruleCode
    && membership.ruleVersion === desired.ruleVersion
    && membership.confidence === desired.confidence
    && membership.approvalStatus === desired.approvalStatus;
}

function equivalentApprovedMembership(membership, desired) {
  return Boolean(membership)
    && membership.productId === desired.productId
    && membership.customerCategoryId === desired.customerCategoryId
    && membership.isPrimary === true
    && membership.assignmentSource === desired.assignmentSource
    && membership.ruleCode === desired.ruleCode
    && membership.confidence === desired.confidence
    && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED;
}

function classifyExisting(candidate, memberships) {
  const desired = desiredMembership(candidate);
  const target = memberships.find((membership) => (
    membership.customerCategoryId === candidate.categoryId
  ));
  const rejected = target?.approvalStatus === CUSTOMER_APPROVAL_STATUS.REJECTED
    ? target
    : null;
  const primaryDecision = evaluateExistingApprovedPrimary(memberships);

  if (primaryDecision.decision === CUSTOMER_TAXONOMY_DECISION.INVALID_EXISTING_PRIMARY) {
    return {
      action: "INVALID_EXISTING_PRIMARY",
      membership: primaryDecision.existingPrimary,
      issues: primaryDecision.issues,
    };
  }
  if (rejected) return { action: "REJECTED_PRESERVED", membership: rejected };
  if (primaryDecision.decision === CUSTOMER_TAXONOMY_DECISION.PRESERVE_MANUAL) {
    return {
      action: "MANUAL_PRESERVED",
      membership: primaryDecision.existingPrimary,
    };
  }
  if (exactDesiredMembership(target, desired)) {
    return { action: "UNCHANGED", membership: target };
  }
  if (equivalentApprovedMembership(target, desired)) {
    return { action: "APPROVED_PRIMARY_PRESERVED", membership: target };
  }
  if (
    primaryDecision.decision
      === CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY
  ) {
    return {
      action: "APPROVED_PRIMARY_PRESERVED",
      membership: primaryDecision.existingPrimary,
    };
  }
  if (target?.approvalStatus === CUSTOMER_APPROVAL_STATUS.REVIEW) {
    return { action: "REVIEW_BLOCKED", membership: target };
  }
  return { action: target ? "UPDATE" : "INSERT", membership: target };
}

function proposalFromCandidate(candidate) {
  return {
    category: {
      id: candidate.categoryId,
      slug: candidate.categorySlug,
      parentSlug: candidate.parentSlug,
    },
    assignmentSource: candidate.assignmentSource,
    assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
    ruleCode: candidate.ruleCode,
    ruleVersion: candidate.ruleVersion,
    confidence: candidate.confidence,
    approvalStatus: candidate.approvalStatus,
    isPrimary: true,
  };
}

function countSections(items) {
  const sections = [...new Set([
    ...CUSTOMER_TAXONOMY_BATCH2_SECTIONS,
    ...CUSTOMER_TAXONOMY_PHASE2E_SECTIONS,
    ...CUSTOMER_TAXONOMY_PHASE2F_SECTIONS,
    ...CUSTOMER_TAXONOMY_PHASE2G1_SECTIONS,
    ...CUSTOMER_TAXONOMY_PHASE2G2_SECTIONS,
    ...CUSTOMER_TAXONOMY_PHASE2G3_SECTIONS,
  ])];
  return Object.fromEntries(sections.map((section) => [
    section,
    items.filter((item) => item.section === section).length,
  ]));
}

function emptyBatch2Coverage() {
  return {
    summary: Object.fromEntries(CUSTOMER_TAXONOMY_BATCH2_SECTIONS.map((section) => [
      section,
      {
        technicalTotal: 0,
        alreadyMember: 0,
        newHighProposal: 0,
        safeTopLevelPossible: 0,
        missingRule: 0,
        realReview: 0,
      },
    ])),
    safeTopLevel: [],
    missingRule: [],
    realReview: [],
    phase2e: null,
    phase2f: null,
    phase2g1: null,
    phase2g2: null,
    phase2g3: null,
  };
}

async function buildBackfillCandidates({
  client,
  repository,
  preview,
  includeSafeTopLevel,
}) {
  const highRule = preview.autoApproved
    .filter((candidate) => candidate.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.RULE)
    .map((candidate) => ({
      ...candidate,
      sectionSlug: candidate.parentSlug || candidate.categorySlug,
      candidateKind: "HIGH_RULE",
    }));
  if (!includeSafeTopLevel) {
    return {
      highRule,
      safeTopLevel: [],
      all: highRule,
      coverage: emptyBatch2Coverage(),
    };
  }

  const batch2Coverage = buildCustomerTaxonomyBatch2Coverage({
    evaluations: preview.evaluations || [],
    additions: preview.additions || [],
  });
  const phase2eCoverage = buildCustomerTaxonomyPhase2ECoverage({
    evaluations: preview.evaluations || [],
    additions: preview.additions || [],
  });
  const phase2fCoverage = buildCustomerTaxonomyPhase2FCoverage({
    evaluations: preview.evaluations || [],
    additions: preview.additions || [],
  });
  const phase2g1Coverage = buildCustomerTaxonomyPhase2G1Coverage({
    evaluations: preview.evaluations || [],
    additions: preview.additions || [],
  });
  const phase2g1AppliedSafeTopLevel = phase2g1Coverage.alreadyMember.filter((item) => (
    item.finalBucket === "SAFE_TOPLEVEL"
    && item.actualCategorySlug === (item.targetSection || item.section)
  ));
  const phase2g2Coverage = buildCustomerTaxonomyPhase2G2Coverage({
    evaluations: preview.evaluations || [],
    additions: preview.additions || [],
  });
  const phase2g2AppliedSafeTopLevel = phase2g2Coverage.alreadyMember.filter((item) => (
    item.finalBucket === "SAFE_TOPLEVEL"
    && item.actualCategorySlug === (item.targetSection || item.section)
  ));
  const phase2g3Coverage = buildCustomerTaxonomyPhase2G3Coverage({
    evaluations: preview.evaluations || [],
    additions: preview.additions || [],
  });
  const phase2g3AppliedSafeTopLevel = phase2g3Coverage.alreadyMember.filter((item) => (
    item.finalBucket === "SAFE_TOPLEVEL"
    && item.actualCategorySlug === (item.targetSection || item.section)
  ));
  const phase2g3AppliedSupplementarySafeTopLevel = phase2g3Coverage.supplementaryBacklog
    .filter((item) => (
      item.finalBucket === "SAFE_TOPLEVEL"
      && item.status === "ALREADY_MEMBER"
      && item.actualCategorySlug === (item.targetSection || item.section)
    ));
  const phase2g3RealReviewProductIds = new Set(
    phase2g3Coverage.realReview.map((item) => item.productId).filter(Number.isInteger),
  );
  const earlierSafeTopLevel = [
    ...batch2Coverage.safeTopLevel,
    ...phase2eCoverage.safeTopLevel,
    ...phase2fCoverage.safeTopLevel,
    ...phase2g1Coverage.safeTopLevel,
    ...phase2g1AppliedSafeTopLevel,
    ...phase2g2Coverage.safeTopLevel,
    ...phase2g2AppliedSafeTopLevel,
  ].filter((item) => !phase2g3RealReviewProductIds.has(item.productId));
  const coverage = {
    summary: batch2Coverage.summary,
    safeTopLevel: [
      ...earlierSafeTopLevel,
      ...phase2g3Coverage.safeTopLevel,
      ...phase2g3Coverage.supplementarySafeTopLevel,
      ...phase2g3AppliedSafeTopLevel,
      ...phase2g3AppliedSupplementarySafeTopLevel,
    ],
    missingRule: [
      ...batch2Coverage.missingRule,
      ...phase2eCoverage.missingRuleRemaining,
      ...phase2fCoverage.missingRuleRemaining,
      ...phase2g1Coverage.missingRuleRemaining,
      ...phase2g2Coverage.missingRuleRemaining,
      ...phase2g3Coverage.missingRuleRemaining,
    ],
    realReview: [
      ...batch2Coverage.realReview,
      ...phase2eCoverage.realReview,
      ...phase2fCoverage.realReview,
      ...phase2g1Coverage.realReview,
      ...phase2g2Coverage.realReview,
      ...phase2g3Coverage.realReview,
    ],
    phase2e: phase2eCoverage,
    phase2f: phase2fCoverage,
    phase2g1: phase2g1Coverage,
    phase2g2: phase2g2Coverage,
    phase2g3: phase2g3Coverage,
  };
  const safeSections = [...new Set(coverage.safeTopLevel.map((item) => (
    item.targetSection || item.section
  )))];
  const categories = await repository.listCategoriesBySlugs(
    safeSections,
    client,
  );
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  const safeTopLevel = coverage.safeTopLevel.map((item) => {
    const section = item.targetSection || item.section;
    const category = categoryBySlug.get(section);
    return {
      ...item,
      categoryId: category?.id ?? null,
      categorySlug: section,
      parentSlug: null,
      sectionSlug: section,
      categoryStatus: category?.status ?? null,
      categoryIsActive: category?.isActive ?? false,
      categoryParentId: category?.parentId ?? null,
      assignmentSource: CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK,
      assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
      ruleCode: null,
      ruleVersion: null,
      confidence: "MEDIUM",
      approvalStatus: CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED,
      isPrimary: true,
      candidateKind: "SAFE_TOPLEVEL_EPC_FALLBACK",
      reason: `${item.reason}; reviewed SAFE_TOPLEVEL EPC fallback`,
    };
  });
  return {
    highRule,
    safeTopLevel,
    all: [...highRule, ...safeTopLevel],
    coverage,
  };
}

function createBaseReport({
  mode,
  expectedCount,
  includeSafeTopLevel,
  preview,
  memberships,
  candidateGroups,
}) {
  const { all: candidates, highRule, safeTopLevel, coverage } = candidateGroups;
  return {
    mode,
    expectedCount,
    includeSafeTopLevel,
    candidateCount: candidates.length,
    inserted: 0,
    insertedHighRule: 0,
    insertedSafeTopLevel: 0,
    updated: 0,
    unchanged: 0,
    manualPreserved: preview.summary.manualPreserved,
    rejectedPreserved: 0,
    approvedPrimaryPreserved: 0,
    conflicts: preview.summary.conflicts,
    review: preview.summary.review,
    errors: [],
    breakdown: buildBreakdown(candidates),
    summary: {
      existingMemberships: memberships.length,
      highRule: highRule.length,
      safeTopLevelEpcFallback: safeTopLevel.length,
      safeTopLevelCandidates: countSections(safeTopLevel),
      realReview: coverage.realReview.length,
      realReviewBySection: countSections(coverage.realReview),
      wouldInsertSafeTopLevel: 0,
      futureMemberships: memberships.length,
    },
    safeTopLevelCandidates: safeTopLevel,
    realReview: coverage.realReview,
  };
}

function preflight({
  report,
  preview,
  candidates,
  rules,
  memberships,
  expectedCount,
  includeSafeTopLevel,
}) {
  const errors = [];
  if (preview.summary.conflicts > 0) errors.push(`CONFLICTS:${preview.summary.conflicts}`);
  if (preview.summary.review > 0) errors.push(`REVIEW:${preview.summary.review}`);
  if (preview.integrity.multiplePrimary.length > 0) {
    errors.push(`MULTIPLE_PRIMARY:${preview.integrity.multiplePrimary.join(",")}`);
  }
  if (preview.integrity.missingPrimary.length > 0) {
    errors.push(`MISSING_PRIMARY:${preview.integrity.missingPrimary.join(",")}`);
  }
  if (expectedCount !== null && candidates.length !== expectedCount) {
    errors.push(`EXPECTED_COUNT_MISMATCH:${expectedCount}:${candidates.length}`);
  }

  const activeRuleByKey = new Map(rules.map((rule) => (
    [ruleKey(rule.code, rule.version), rule]
  )));
  for (const rule of rules) {
    if (rule.detectorVersion !== CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION) {
      errors.push(
        `DETECTOR_VERSION_MISMATCH:${rule.code}:${rule.detectorVersion}`,
      );
    }
  }

  const candidateCountByProduct = new Map();
  for (const candidate of candidates) {
    candidateCountByProduct.set(
      candidate.productId,
      (candidateCountByProduct.get(candidate.productId) || 0) + 1,
    );
    const isHighRule = candidate.candidateKind === "HIGH_RULE";
    const isSafeTopLevel = candidate.candidateKind === "SAFE_TOPLEVEL_EPC_FALLBACK";
    if (!isHighRule && !isSafeTopLevel) {
      errors.push(`UNSAFE_PROPOSAL:${candidate.productId}:${candidate.categoryId}`);
      continue;
    }
    if (isSafeTopLevel) {
      const dedicatedEpc = {
        steering: "46",
        exhaust: "49",
        wheels: "40",
      }[candidate.sectionSlug];
      const reviewedPhase2E = candidate.reviewSource === "PHASE_2E_AUDIT"
        && isReviewedPhase2ESafeTopLevel({
          article: candidate.article,
          technicalEpcGroups: candidate.technicalEpc,
        }, candidate.sectionSlug);
      const reviewedPhase2F = candidate.reviewSource === "PHASE_2F_AUDIT"
        && isReviewedPhase2FSafeTopLevel({
          article: candidate.article,
          technicalEpcGroups: candidate.technicalEpc,
        }, candidate.sectionSlug);
      const reviewedPhase2G1 = candidate.reviewSource === "PHASE_2G1_AUDIT"
        && isReviewedPhase2G1SafeTopLevel({
          article: candidate.article,
          technicalEpcGroups: candidate.technicalEpc,
        }, candidate.sectionSlug);
      const reviewedPhase2G2 = candidate.reviewSource === "PHASE_2G2_AUDIT"
        && isReviewedPhase2G2SafeTopLevel({
          article: candidate.article,
          technicalEpcGroups: candidate.technicalEpc,
        }, candidate.sectionSlug);
      const reviewedPhase2G3 = candidate.reviewSource === "PHASE_2G3_AUDIT"
        && isReviewedPhase2G3SafeTopLevel({
          article: candidate.article,
          technicalEpcGroups: candidate.technicalEpc,
        }, candidate.sectionSlug);
      if (
        includeSafeTopLevel !== true
        || candidate.approvalStatus !== CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
        || candidate.confidence !== "MEDIUM"
        || candidate.assignmentSource !== CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK
        || candidate.isPrimary !== true
        || candidate.ruleCode !== null
        || candidate.ruleVersion !== null
        || candidate.categorySlug !== candidate.sectionSlug
        || candidate.categoryParentId !== null
        || candidate.categoryStatus !== "ACTIVE"
        || candidate.categoryIsActive !== true
        || (!reviewedPhase2E && !reviewedPhase2F && !reviewedPhase2G1
          && !reviewedPhase2G2 && !reviewedPhase2G3 && (
          !dedicatedEpc
          || !(candidate.technicalEpc || []).map(String).includes(dedicatedEpc)
        ))
      ) {
        errors.push(`UNSAFE_SAFE_TOPLEVEL:${candidate.productId}:${candidate.categorySlug}`);
      }
      continue;
    }
    if (
      candidate.approvalStatus !== CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
      || candidate.confidence !== "HIGH"
      || candidate.assignmentSource !== CUSTOMER_ASSIGNMENT_SOURCE.RULE
      || candidate.isPrimary !== true
    ) {
      errors.push(`UNSAFE_PROPOSAL:${candidate.productId}:${candidate.categoryId}`);
      continue;
    }
    const rule = activeRuleByKey.get(ruleKey(candidate.ruleCode, candidate.ruleVersion));
    if (!rule) {
      errors.push(`MISSING_OR_INACTIVE_RULE:${candidate.ruleCode}:${candidate.ruleVersion}`);
      continue;
    }
    if (
      rule.isActive !== true
      || rule.autoApprovalAllowed !== true
      || rule.confidence !== "HIGH"
      || rule.sourceKind !== CUSTOMER_ASSIGNMENT_SOURCE.RULE
      || rule.assignmentRole !== "PRIMARY"
    ) {
      errors.push(`UNSAFE_RULE:${candidate.ruleCode}:${candidate.ruleVersion}`);
    }
    if (
      rule.targetCategoryId !== candidate.categoryId
      || rule.targetStatus !== "ACTIVE"
      || rule.targetIsActive !== true
    ) {
      errors.push(`MISSING_OR_INACTIVE_TARGET:${candidate.ruleCode}:${candidate.categoryId}`);
    }
  }
  for (const [productId, count] of candidateCountByProduct) {
    if (count !== 1) errors.push(`PRIMARY_PROPOSAL_COUNT:${productId}:${count}`);
  }

  const membershipsByProduct = new Map();
  for (const membership of memberships) {
    const list = membershipsByProduct.get(membership.productId) || [];
    list.push(membership);
    membershipsByProduct.set(membership.productId, list);
  }
  const manualProducts = new Set(preview.manualPreserved.map((item) => item.productId));
  const rejectedProducts = new Set();
  const approvedPrimaryProducts = new Set();
  let unchanged = 0;
  let wouldInsert = 0;
  let wouldUpdate = 0;
  let wouldInsertSafeTopLevel = 0;
  for (const candidate of candidates) {
    const classification = classifyExisting(
      candidate,
      membershipsByProduct.get(candidate.productId) || [],
    );
    if (classification.action === "MANUAL_PRESERVED") manualProducts.add(candidate.productId);
    if (classification.action === "REJECTED_PRESERVED") rejectedProducts.add(candidate.productId);
    if (classification.action === "APPROVED_PRIMARY_PRESERVED") {
      approvedPrimaryProducts.add(candidate.productId);
    }
    if (classification.action === "REVIEW_BLOCKED") {
      errors.push(`EXISTING_REVIEW_DECISION:${candidate.productId}:${candidate.categoryId}`);
    }
    if (classification.action === "INVALID_EXISTING_PRIMARY") {
      errors.push(
        `INVALID_EXISTING_PRIMARY:${candidate.productId}:${classification.issues.join(",")}`,
      );
    }
    if (classification.action === "UNCHANGED") unchanged += 1;
    if (classification.action === "INSERT") {
      wouldInsert += 1;
      if (candidate.candidateKind === "SAFE_TOPLEVEL_EPC_FALLBACK") {
        wouldInsertSafeTopLevel += 1;
      }
    }
    if (classification.action === "UPDATE") wouldUpdate += 1;
  }
  report.manualPreserved = manualProducts.size;
  report.rejectedPreserved = rejectedProducts.size;
  report.approvedPrimaryPreserved = approvedPrimaryProducts.size;
  report.unchanged = unchanged;
  report.wouldInsert = wouldInsert;
  report.wouldUpdate = wouldUpdate;
  report.summary.wouldInsertSafeTopLevel = wouldInsertSafeTopLevel;
  report.summary.futureMemberships = memberships.length + wouldInsert;
  report.errors.push(...new Set(errors));
  return membershipsByProduct;
}

function verifyCandidateMemberships(report, candidates, memberships) {
  const byKey = new Map(memberships.map((membership) => [
    membershipKey(membership.productId, membership.customerCategoryId),
    membership,
  ]));
  const verified = [];
  for (const candidate of candidates) {
    const membership = byKey.get(membershipKey(candidate.productId, candidate.categoryId));
    if (!membership) {
      report.errors.push(`MISSING_BACKFILL_MEMBERSHIP:${candidate.productId}:${candidate.categoryId}`);
      continue;
    }
    const desired = desiredMembership(candidate);
    if (
      !exactDesiredMembership(membership, desired)
      && !equivalentApprovedMembership(membership, desired)
    ) {
      report.errors.push(`STALE_BACKFILL_MEMBERSHIP:${candidate.productId}:${candidate.categoryId}`);
      continue;
    }
    verified.push(membership);
  }
  return {
    memberships: verified.length,
    primary: verified.filter((item) => item.isPrimary).length,
    rule: verified.filter((item) => (
      item.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.RULE
    )).length,
    epcFallback: verified.filter((item) => (
      item.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK
    )).length,
    high: verified.filter((item) => item.confidence === "HIGH").length,
    medium: verified.filter((item) => item.confidence === "MEDIUM").length,
    autoApproved: verified.filter((item) => (
      item.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
    )).length,
    review: verified.filter((item) => (
      item.approvalStatus === CUSTOMER_APPROVAL_STATUS.REVIEW
    )).length,
  };
}

export async function runCustomerTaxonomyBackfill({
  mode = "DRY_RUN",
  expectedCount = null,
  confirmation = null,
  includeSafeTopLevel = false,
  dbPool = pool,
  repository = CustomerTaxonomyRepository,
  assignmentService = CustomerTaxonomyAssignmentService,
  resolver,
} = {}) {
  if (!["DRY_RUN", "APPLY", "VERIFY"].includes(mode)) {
    throw new Error(`Unsupported customer taxonomy backfill mode: ${mode}`);
  }
  const requiredConfirmation = includeSafeTopLevel
    ? CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION
    : CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION;
  if (mode === "APPLY" && confirmation !== requiredConfirmation) {
    throw new Error(
      `APPLY requires confirmation ${requiredConfirmation}`,
    );
  }

  const client = typeof dbPool.connect === "function"
    ? await dbPool.connect()
    : dbPool;
  const release = client !== dbPool && typeof client.release === "function";
  let transactionOpen = false;
  try {
    await client.query(mode === "APPLY"
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
      : "BEGIN READ ONLY");
    transactionOpen = true;
    const preview = await buildCustomerTaxonomyPreview({
      db: client,
      repository,
      resolver,
      assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
      includeEvaluations: includeSafeTopLevel,
    });
    const candidateGroups = await buildBackfillCandidates({
      client,
      repository,
      preview,
      includeSafeTopLevel,
    });
    const candidates = [...candidateGroups.all].sort((left, right) => (
      left.productId - right.productId || left.categoryId - right.categoryId
    ));
    const rules = await repository.listActiveRules(client);
    const memberships = await repository.listMemberships(client);
    const report = createBaseReport({
      mode,
      expectedCount,
      includeSafeTopLevel,
      preview,
      memberships,
      candidateGroups,
    });
    preflight({
      report,
      preview,
      candidates,
      rules,
      memberships,
      expectedCount,
      includeSafeTopLevel,
    });

    if (mode === "VERIFY") {
      report.verification = await repository.getBackfillVerification(client);
      report.candidateVerification = verifyCandidateMemberships(
        report,
        candidates,
        memberships,
      );
      if (report.verification.duplicatePrimary > 0) {
        report.errors.push(`DUPLICATE_PRIMARY:${report.verification.duplicatePrimary}`);
      }
      if (report.verification.orphanRule > 0) {
        report.errors.push(`ORPHAN_RULE:${report.verification.orphanRule}`);
      }
      if (report.verification.inactiveTarget > 0) {
        report.errors.push(`INACTIVE_TARGET:${report.verification.inactiveTarget}`);
      }
      await client.query("ROLLBACK");
      transactionOpen = false;
      return report;
    }

    if (mode === "DRY_RUN") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return report;
    }

    if (report.errors.length) {
      throw new CustomerTaxonomyBackfillError("Customer taxonomy backfill preflight failed", report);
    }

    report.unchanged = 0;
    report.manualPreserved = preview.summary.manualPreserved;
    report.rejectedPreserved = 0;
    report.approvedPrimaryPreserved = 0;
    for (const candidate of candidates) {
      await repository.lockProductForAssignment(candidate.productId, client);
      const existing = await repository.listMembershipsForProduct(
        candidate.productId,
        client,
        { lock: true },
      );
      const classification = classifyExisting(candidate, existing);
      if (classification.action === "MANUAL_PRESERVED") {
        continue;
      }
      if (classification.action === "REJECTED_PRESERVED") {
        report.rejectedPreserved += 1;
        continue;
      }
      if (classification.action === "APPROVED_PRIMARY_PRESERVED") {
        report.approvedPrimaryPreserved += 1;
        continue;
      }
      if (classification.action === "REVIEW_BLOCKED") {
        throw new CustomerTaxonomyBackfillError(
          `Customer taxonomy REVIEW decision appeared for product ${candidate.productId}`,
          report,
        );
      }
      if (classification.action === "INVALID_EXISTING_PRIMARY") {
        throw new CustomerTaxonomyBackfillError(
          `Invalid existing customer taxonomy primary for product ${candidate.productId}`,
          report,
        );
      }
      if (classification.action === "UNCHANGED") {
        report.unchanged += 1;
        continue;
      }

      const result = await assignmentService.applyResolutionInTransaction({
        productId: candidate.productId,
        resolution: { proposals: [proposalFromCandidate(candidate)] },
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
      }, { db: client, repository });
      if (result.applied.length !== 1) {
        throw new CustomerTaxonomyBackfillError(
          `Customer taxonomy assignment was not applied for product ${candidate.productId}`,
          report,
        );
      }
      if (classification.action === "INSERT") report.inserted += 1;
      if (
        classification.action === "INSERT"
        && candidate.candidateKind === "HIGH_RULE"
      ) {
        report.insertedHighRule += 1;
      }
      if (
        classification.action === "INSERT"
        && candidate.candidateKind === "SAFE_TOPLEVEL_EPC_FALLBACK"
      ) {
        report.insertedSafeTopLevel += 1;
      }
      if (classification.action === "UPDATE") report.updated += 1;
    }

    report.summary.futureMemberships = memberships.length + report.inserted;

    await client.query("COMMIT");
    transactionOpen = false;
    return report;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (release) client.release();
  }
}

export const CustomerTaxonomyBackfillService = {
  run: runCustomerTaxonomyBackfill,
};
