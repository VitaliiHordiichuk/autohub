import { pool } from "../config/db.js";
import { CustomerTaxonomyRepository } from "../repositories/CustomerTaxonomyRepository.js";
import { CustomerTaxonomyAssignmentService } from "./CustomerTaxonomyAssignmentService.js";
import { buildCustomerTaxonomyPreview } from "./CustomerTaxonomyPreviewService.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_ASSIGNMENT_SOURCE,
} from "./CustomerTaxonomyResolver.js";
import { CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION } from "./CustomerProductTypeDetector.js";

export const CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION = "AUTO_APPROVED_ONLY";

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

  if (mode === "APPLY" && confirmation !== CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION) {
    throw new Error(
      `--apply requires --confirm=${CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION}`,
    );
  }
  return { mode, expectedCount, confirmation };
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
  };
  const leaves = {};
  for (const candidate of candidates) {
    sections[candidate.parentSlug] = (sections[candidate.parentSlug] || 0) + 1;
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
    assignmentSource: CUSTOMER_ASSIGNMENT_SOURCE.RULE,
    assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
    ruleCode: candidate.ruleCode,
    ruleVersion: candidate.ruleVersion,
    confidence: "HIGH",
    approvalStatus: CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED,
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
    && membership.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.RULE
    && membership.ruleCode === desired.ruleCode
    && membership.confidence === desired.confidence
    && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED;
}

function classifyExisting(candidate, memberships) {
  const desired = desiredMembership(candidate);
  const target = memberships.find((membership) => (
    membership.customerCategoryId === candidate.categoryId
  ));
  const manual = memberships.find((membership) => (
    membership.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.MANUAL
    && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.MANUAL_APPROVED
  ));
  const rejected = target?.approvalStatus === CUSTOMER_APPROVAL_STATUS.REJECTED
    ? target
    : null;
  const otherApprovedPrimary = memberships.find((membership) => (
    membership.isPrimary
    && membership.customerCategoryId !== candidate.categoryId
    && [
      CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED,
      CUSTOMER_APPROVAL_STATUS.MANUAL_APPROVED,
    ].includes(membership.approvalStatus)
  ));

  if (manual) return { action: "MANUAL_PRESERVED", membership: manual };
  if (rejected) return { action: "REJECTED_PRESERVED", membership: rejected };
  if (otherApprovedPrimary) {
    return { action: "APPROVED_PRIMARY_PRESERVED", membership: otherApprovedPrimary };
  }
  if (exactDesiredMembership(target, desired)) {
    return { action: "UNCHANGED", membership: target };
  }
  if (equivalentApprovedMembership(target, desired)) {
    return { action: "APPROVED_PRIMARY_PRESERVED", membership: target };
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

function createBaseReport({ mode, expectedCount, preview, candidates }) {
  return {
    mode,
    expectedCount,
    candidateCount: candidates.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    manualPreserved: preview.summary.manualPreserved,
    rejectedPreserved: 0,
    approvedPrimaryPreserved: 0,
    conflicts: preview.summary.conflicts,
    review: preview.summary.review,
    errors: [],
    breakdown: buildBreakdown(candidates),
  };
}

function preflight({ report, preview, candidates, rules, memberships, expectedCount }) {
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
    if (classification.action === "UNCHANGED") unchanged += 1;
    if (classification.action === "INSERT") wouldInsert += 1;
    if (classification.action === "UPDATE") wouldUpdate += 1;
  }
  report.manualPreserved = manualProducts.size;
  report.rejectedPreserved = rejectedProducts.size;
  report.approvedPrimaryPreserved = approvedPrimaryProducts.size;
  report.unchanged = unchanged;
  report.wouldInsert = wouldInsert;
  report.wouldUpdate = wouldUpdate;
  report.errors.push(...new Set(errors));
  return membershipsByProduct;
}

function verifyCandidateMemberships(report, candidates, memberships) {
  const byKey = new Map(memberships.map((membership) => [
    membershipKey(membership.productId, membership.customerCategoryId),
    membership,
  ]));
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
    }
  }
}

export async function runCustomerTaxonomyBackfill({
  mode = "DRY_RUN",
  expectedCount = null,
  confirmation = null,
  dbPool = pool,
  repository = CustomerTaxonomyRepository,
  assignmentService = CustomerTaxonomyAssignmentService,
  resolver,
} = {}) {
  if (!["DRY_RUN", "APPLY", "VERIFY"].includes(mode)) {
    throw new Error(`Unsupported customer taxonomy backfill mode: ${mode}`);
  }
  if (mode === "APPLY" && confirmation !== CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION) {
    throw new Error(
      `APPLY requires confirmation ${CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION}`,
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
    });
    const candidates = [...preview.autoApproved].sort((left, right) => (
      left.productId - right.productId || left.categoryId - right.categoryId
    ));
    const rules = await repository.listActiveRules(client);
    const memberships = await repository.listMemberships(client);
    const report = createBaseReport({ mode, expectedCount, preview, candidates });
    preflight({ report, preview, candidates, rules, memberships, expectedCount });

    if (mode === "VERIFY") {
      report.verification = await repository.getBackfillVerification(client);
      verifyCandidateMemberships(report, candidates, memberships);
      for (const field of [
        "memberships",
        "approvedPrimary",
        "rule",
        "backfill",
        "high",
        "autoApproved",
      ]) {
        if (report.verification[field] !== candidates.length) {
          report.errors.push(
            `VERIFY_COUNT_MISMATCH:${field}:${candidates.length}:${report.verification[field]}`,
          );
        }
      }
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
        report.manualPreserved += 1;
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
      if (classification.action === "UPDATE") report.updated += 1;
    }

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
