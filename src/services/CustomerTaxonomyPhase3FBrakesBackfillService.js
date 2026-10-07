import { pool } from "../config/db.js";
import { CustomerTaxonomyRepository } from "../repositories/CustomerTaxonomyRepository.js";
import { CustomerTaxonomyAssignmentService } from "./CustomerTaxonomyAssignmentService.js";
import { CustomerTaxonomyImportService } from "./CustomerTaxonomyImportService.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_ASSIGNMENT_SOURCE,
  CUSTOMER_TAXONOMY_DECISION,
} from "./CustomerTaxonomyResolver.js";

export const PHASE3F_BRAKES_CONFIRMATION = "PHASE3F4_BRAKES_BACKFILL";
export const PHASE3F_BRAKES_EXPECTED_HIGH = 1;
export const PHASE3F_BRAKES_EXPECTED_SAFE = 96;
export const PHASE3F_BRAKES_EXPECTED_HIGH_PRODUCT_ID = 6652;
export const PHASE3F_BRAKES_EXPECTED_HIGH_ARTICLE = "A1674216003";

const approvedStatuses = new Set([
  CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED,
  CUSTOMER_APPROVAL_STATUS.MANUAL_APPROVED,
]);
const reviewedBrakeEpcGroups = new Set(["42", "43"]);

export class CustomerTaxonomyPhase3FBrakesBackfillError extends Error {
  constructor(message, report = null) {
    super(message);
    this.name = "CustomerTaxonomyPhase3FBrakesBackfillError";
    this.report = report;
  }
}

export function parsePhase3FBrakesBackfillArguments(argumentsList = []) {
  let mode = "DRY_RUN";
  let confirmation = null;
  for (const argument of argumentsList) {
    if (argument === "--apply") {
      mode = "APPLY";
      continue;
    }
    if (argument.startsWith("--confirm=")) {
      confirmation = argument.slice("--confirm=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (mode === "APPLY" && confirmation !== PHASE3F_BRAKES_CONFIRMATION) {
    throw new Error(`--apply requires --confirm=${PHASE3F_BRAKES_CONFIRMATION}`);
  }
  return { mode, confirmation };
}

function approvedPrimary(memberships) {
  return memberships.find((membership) => (
    membership.isPrimary === true
    && approvedStatuses.has(membership.approvalStatus)
  )) || null;
}

function candidateKind(candidate) {
  if (
    candidate?.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.RULE
    && candidate.confidence === "HIGH"
    && candidate.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
  ) return "HIGH";
  if (
    candidate?.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK
    && candidate.confidence === "MEDIUM"
    && candidate.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
  ) return "SAFE";
  return null;
}

function candidateDetail(product, evaluation, kind) {
  const candidate = evaluation.candidate;
  return {
    productId: product.id,
    article: product.article,
    name: product.name,
    technicalEpcGroups: product.technicalEpcGroups,
    kind,
    categoryId: candidate.category.id,
    categorySlug: candidate.category.slug,
    assignmentSource: candidate.assignmentSource,
    assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
    confidence: candidate.confidence,
    approvalStatus: candidate.approvalStatus,
    ruleCode: candidate.ruleCode ?? null,
    ruleVersion: candidate.ruleVersion ?? null,
  };
}

function addError(report, error) {
  if (!report.errors.includes(error)) report.errors.push(error);
}

function validateCandidate(
  report,
  detail,
  { expectedHighProductId, expectedHighArticle },
) {
  if (detail.kind === "HIGH" && detail.categorySlug !== "brakes-discs") {
    addError(report, `UNEXPECTED_HIGH_TARGET:${detail.productId}:${detail.categorySlug}`);
  }
  if (detail.kind === "HIGH" && (
    detail.productId !== expectedHighProductId
    || String(detail.article || "").trim().toUpperCase() !== expectedHighArticle
  )) {
    addError(report, `UNEXPECTED_HIGH_PRODUCT:${detail.productId}:${detail.article}`);
  }
  if (detail.kind === "SAFE" && detail.categorySlug !== "brakes") {
    addError(report, `UNEXPECTED_SAFE_TARGET:${detail.productId}:${detail.categorySlug}`);
  }
  if (detail.kind === "SAFE" && !(detail.technicalEpcGroups || []).some((epc) => (
    reviewedBrakeEpcGroups.has(String(epc))
  ))) {
    addError(report, `UNEXPECTED_SAFE_EPC:${detail.productId}`);
  }
  if (detail.kind === "SAFE" && (
    detail.ruleCode !== null
    || detail.ruleVersion !== null
    || detail.assignmentSource !== CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK
  )) {
    addError(report, `INVALID_SAFE_PROVENANCE:${detail.productId}`);
  }
}

function expectedCounts(report, expectedHigh, expectedSafe) {
  const totalHigh = report.outstanding.high.length;
  const totalSafe = report.outstanding.safe.length;
  report.idempotentNoop = totalHigh === 0 && totalSafe === 0;
  if (report.idempotentNoop) {
    report.summary = {
      scopeProducts: report.scopeProducts,
      high: 0,
      safe: 0,
      unclassified: report.unclassified,
      realReview: report.realReview.length,
      preservedApprovedPrimary: report.preservedApprovedPrimary,
      idempotentNoop: true,
    };
    return;
  }
  if (totalHigh !== expectedHigh) {
    addError(report, `EXPECTED_HIGH_MISMATCH:${expectedHigh}:${totalHigh}`);
  }
  if (totalSafe !== expectedSafe) {
    addError(report, `EXPECTED_SAFE_MISMATCH:${expectedSafe}:${totalSafe}`);
  }
  report.summary = {
    scopeProducts: report.scopeProducts,
    high: totalHigh,
    safe: totalSafe,
    unclassified: report.unclassified,
    realReview: report.realReview.length,
    preservedApprovedPrimary: report.preservedApprovedPrimary,
    idempotentNoop: false,
  };
}

async function scan({
  client,
  repository,
  taxonomyService,
  context,
  expectedHigh,
  expectedSafe,
  expectedHighProductId,
  expectedHighArticle,
}) {
  const products = await repository.listProductsForPreview(client);
  const memberships = await repository.listMemberships(client);
  const membershipsByProduct = new Map();
  for (const membership of memberships) {
    const list = membershipsByProduct.get(membership.productId) || [];
    list.push(membership);
    membershipsByProduct.set(membership.productId, list);
  }
  const report = {
    scopeProducts: 0,
    outstanding: { high: [], safe: [] },
    unclassified: 0,
    realReview: [],
    preservedApprovedPrimary: 0,
    errors: [],
  };

  for (const product of products) {
    const existingMemberships = membershipsByProduct.get(product.id) || [];
    const existingPrimary = approvedPrimary(existingMemberships);
    if (existingPrimary) {
      report.preservedApprovedPrimary += 1;
      continue;
    }
    const evaluation = await taxonomyService.evaluateProduct({
      product,
      existingMemberships,
      context,
    }, {
      db: client,
      repository,
      assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
    });
    const kind = candidateKind(evaluation.candidate);
    report.scopeProducts += 1;
    if (kind) {
      const detail = candidateDetail(product, evaluation, kind);
      validateCandidate(report, detail, {
        expectedHighProductId,
        expectedHighArticle,
      });
      report.outstanding[kind.toLowerCase()].push(detail);
    } else {
      report.unclassified += 1;
      if (evaluation.candidate) {
        addError(report, `UNSUPPORTED_AUTO_CANDIDATE:${product.id}`);
      }
      if (evaluation.disposition.requiresReview) {
        report.realReview.push({
          productId: product.id,
          article: product.article,
          reason: evaluation.disposition.reason,
        });
      }
    }
  }
  expectedCounts(report, expectedHigh, expectedSafe);
  return report;
}

function fullReport({
  mode,
  confirmation,
  expectedHigh,
  expectedSafe,
  expectedHighProductId,
  expectedHighArticle,
  scanReport,
}) {
  return {
    mode,
    confirmationProvided: confirmation === PHASE3F_BRAKES_CONFIRMATION,
    expected: {
      high: expectedHigh,
      safe: expectedSafe,
      total: expectedHigh + expectedSafe,
      highProductId: expectedHighProductId,
      highArticle: expectedHighArticle,
    },
    ...scanReport,
    applied: { high: 0, safe: 0, total: 0 },
    verification: null,
  };
}

function applyTargets(report) {
  return [...report.outstanding.high, ...report.outstanding.safe]
    .sort((left, right) => left.productId - right.productId);
}

function exactMembershipForDetail(memberships, detail) {
  return memberships.find((membership) => (
    membership.productId === detail.productId
    && membership.customerCategoryId === detail.categoryId
    && membership.isPrimary === true
    && membership.assignmentSource === detail.assignmentSource
    && membership.assignmentOrigin === CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL
    && membership.ruleCode === detail.ruleCode
    && membership.ruleVersion === detail.ruleVersion
    && membership.confidence === detail.confidence
    && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
  )) || null;
}

export async function runPhase3FBrakesBackfill({
  mode = "DRY_RUN",
  confirmation = null,
  expectedHigh = PHASE3F_BRAKES_EXPECTED_HIGH,
  expectedSafe = PHASE3F_BRAKES_EXPECTED_SAFE,
  expectedHighProductId = PHASE3F_BRAKES_EXPECTED_HIGH_PRODUCT_ID,
  expectedHighArticle = PHASE3F_BRAKES_EXPECTED_HIGH_ARTICLE,
  dbPool = pool,
  repository = CustomerTaxonomyRepository,
  taxonomyService = CustomerTaxonomyImportService,
  assignmentService = CustomerTaxonomyAssignmentService,
} = {}) {
  if (!["DRY_RUN", "APPLY"].includes(mode)) {
    throw new Error(`Unsupported PHASE 3F brakes backfill mode: ${mode}`);
  }
  if (mode === "APPLY" && confirmation !== PHASE3F_BRAKES_CONFIRMATION) {
    throw new Error(`APPLY requires confirmation ${PHASE3F_BRAKES_CONFIRMATION}`);
  }
  const client = typeof dbPool.connect === "function"
    ? await dbPool.connect()
    : dbPool;
  const release = client !== dbPool && typeof client.release === "function";
  let transactionOpen = false;
  let report = null;
  try {
    await client.query(mode === "APPLY"
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
      : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const context = await taxonomyService.createContext({ db: client, repository });
    const scanReport = await scan({
      client,
      repository,
      taxonomyService,
      context,
      expectedHigh,
      expectedSafe,
      expectedHighProductId,
      expectedHighArticle,
    });
    report = fullReport({
      mode,
      confirmation,
      expectedHigh,
      expectedSafe,
      expectedHighProductId,
      expectedHighArticle,
      scanReport,
    });
    const globalBefore = await repository.getBackfillVerification(client);
    if (globalBefore.duplicatePrimary !== 0) {
      addError(report, `DUPLICATE_PRIMARY:${globalBefore.duplicatePrimary}`);
    }

    if (mode === "DRY_RUN") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return report;
    }
    if (report.errors.length) {
      throw new CustomerTaxonomyPhase3FBrakesBackfillError(
        "PHASE 3F brakes backfill preflight failed",
        report,
      );
    }
    if (report.idempotentNoop) {
      report.verification = {
        high: 0,
        safe: 0,
        total: 0,
        duplicatePrimary: globalBefore.duplicatePrimary,
      };
      await client.query("ROLLBACK");
      transactionOpen = false;
      return report;
    }

    for (const target of applyTargets(report)) {
      const result = await taxonomyService.classifyProduct({
        productId: target.productId,
        context,
      }, {
        db: client,
        repository,
        assignmentService,
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
      });
      const expectedDecision = target.kind === "HIGH"
        ? CUSTOMER_TAXONOMY_DECISION.ASSIGNED_NEW_HIGH
        : CUSTOMER_TAXONOMY_DECISION.ASSIGNED_SAFE;
      if (result.decision !== expectedDecision || result.finalCategory !== target.categorySlug) {
        addError(
          report,
          `APPLY_RESULT_MISMATCH:${target.productId}:${result.decision}:${result.finalCategory}`,
        );
        break;
      }
      report.applied[target.kind.toLowerCase()] += 1;
      report.applied.total += 1;
    }

    const membershipsAfter = await repository.listMemberships(client);
    const expectedTargets = [
      ...report.outstanding.high,
      ...report.outstanding.safe,
    ];
    const verifiedHigh = expectedTargets.filter((target) => (
      target.kind === "HIGH" && exactMembershipForDetail(membershipsAfter, target)
    )).length;
    const verifiedSafe = expectedTargets.filter((target) => (
      target.kind === "SAFE" && exactMembershipForDetail(membershipsAfter, target)
    )).length;
    const globalAfter = await repository.getBackfillVerification(client);
    report.verification = {
      high: verifiedHigh,
      safe: verifiedSafe,
      total: verifiedHigh + verifiedSafe,
      duplicatePrimary: globalAfter.duplicatePrimary,
    };
    if (verifiedHigh !== expectedHigh) {
      addError(report, `VERIFIED_HIGH_MISMATCH:${expectedHigh}:${verifiedHigh}`);
    }
    if (verifiedSafe !== expectedSafe) {
      addError(report, `VERIFIED_SAFE_MISMATCH:${expectedSafe}:${verifiedSafe}`);
    }
    if (globalAfter.duplicatePrimary !== 0) {
      addError(report, `DUPLICATE_PRIMARY:${globalAfter.duplicatePrimary}`);
    }
    if (
      report.applied.high !== expectedHigh
      || report.applied.safe !== expectedSafe
      || report.applied.total !== expectedHigh + expectedSafe
    ) {
      addError(
        report,
        `APPLIED_COUNT_MISMATCH:${report.applied.high}:${report.applied.safe}:${report.applied.total}`,
      );
    }
    if (report.errors.length) {
      throw new CustomerTaxonomyPhase3FBrakesBackfillError(
        "PHASE 3F brakes backfill verification failed",
        report,
      );
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return report;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    if (
      error instanceof CustomerTaxonomyPhase3FBrakesBackfillError
      || !report
    ) throw error;
    throw new CustomerTaxonomyPhase3FBrakesBackfillError(error.message, report);
  } finally {
    if (release) client.release();
  }
}

export const CustomerTaxonomyPhase3FBrakesBackfillService = {
  run: runPhase3FBrakesBackfill,
};
