import { pool } from "../config/db.js";
import { CustomerTaxonomyRepository } from "../repositories/CustomerTaxonomyRepository.js";
import { CustomerTaxonomyAssignmentService } from "./CustomerTaxonomyAssignmentService.js";
import { detectCustomerProductTypes } from "./CustomerProductTypeDetector.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_ASSIGNMENT_SOURCE,
  resolveCustomerTaxonomy,
} from "./CustomerTaxonomyResolver.js";

export const WINDSHIELD_BACKFILL_CONFIRMATION = "CUSTOMER_TAXONOMY_WINDSHIELDS";
const WINDSHIELD_TYPE = "GLASS_WINDSHIELD";
const WINDSHIELD_CATEGORY = "body-windshields";
const SAFE_ROOT_CATEGORY = "body-glass";

export class CustomerTaxonomyWindshieldBackfillError extends Error {
  constructor(message, report = null) {
    super(message);
    this.name = "CustomerTaxonomyWindshieldBackfillError";
    this.report = report;
  }
}

export function parseWindshieldBackfillArguments(argumentsList = []) {
  let mode = "DRY_RUN";
  let confirmation = null;
  let expectedCount = null;
  for (const argument of argumentsList) {
    if (argument === "--apply") {
      mode = "APPLY";
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
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (mode === "APPLY") {
    if (confirmation !== WINDSHIELD_BACKFILL_CONFIRMATION) {
      throw new Error(`--apply requires --confirm=${WINDSHIELD_BACKFILL_CONFIRMATION}`);
    }
    if (!Number.isSafeInteger(expectedCount)) {
      throw new Error("--apply requires --expected-count from the reviewed dry-run");
    }
  }
  return { mode, confirmation, expectedCount };
}

function isApproved(membership) {
  return [
    CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED,
    CUSTOMER_APPROVAL_STATUS.MANUAL_APPROVED,
  ].includes(membership.approvalStatus);
}

function exactSafeRoot(membership) {
  return membership.categorySlug === SAFE_ROOT_CATEGORY
    && membership.isPrimary === true
    && membership.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK
    && membership.confidence === "MEDIUM"
    && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
    && membership.ruleCode === null
    && membership.ruleVersion === null;
}

function exactTarget(membership, proposal) {
  return membership.categorySlug === WINDSHIELD_CATEGORY
    && membership.isPrimary === true
    && membership.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.RULE
    && membership.confidence === "HIGH"
    && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
    && membership.ruleCode === proposal.ruleCode
    && membership.ruleVersion === proposal.ruleVersion;
}

function productDetail(product, state, proposal, existingPrimary = null) {
  return {
    productId: product.id,
    article: product.article,
    name: product.name,
    translations: product.translations || [],
    technicalEpcGroups: product.technicalEpcGroups || [],
    state,
    currentCategory: existingPrimary?.categorySlug || null,
    targetCategory: proposal?.category?.slug || null,
    ruleCode: proposal?.ruleCode || null,
    ruleVersion: proposal?.ruleVersion || null,
  };
}

export function buildWindshieldBackfillPlan({ products, memberships, rules }) {
  const membershipsByProduct = new Map();
  for (const membership of memberships) {
    const rows = membershipsByProduct.get(membership.productId) || [];
    rows.push(membership);
    membershipsByProduct.set(membership.productId, rows);
  }
  const plan = {
    detected: [],
    outstanding: [],
    insert: [],
    upgradeSafeRoot: [],
    alreadyClassified: [],
    preservedManual: [],
    conflicts: [],
    errors: [],
  };

  for (const product of products) {
    if (!detectCustomerProductTypes(product).includes(WINDSHIELD_TYPE)) continue;
    const rows = membershipsByProduct.get(product.id) || [];
    const approvedPrimary = rows.filter((membership) => membership.isPrimary && isApproved(membership));
    const resolution = resolveCustomerTaxonomy({
      product,
      rules,
      existingMemberships: [],
      assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
    });
    const proposal = resolution.proposals.find((item) => (
      item.isPrimary
      && item.category.slug === WINDSHIELD_CATEGORY
      && item.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.RULE
      && item.confidence === "HIGH"
      && item.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
    )) || null;
    if (!proposal || resolution.conflicts.length) {
      const detail = productDetail(product, "RULE_MISMATCH", proposal, approvedPrimary[0]);
      plan.conflicts.push(detail);
      plan.detected.push(detail);
      continue;
    }
    if (approvedPrimary.length > 1) {
      const detail = productDetail(product, "DUPLICATE_PRIMARY", proposal, approvedPrimary[0]);
      plan.conflicts.push(detail);
      plan.errors.push(`DUPLICATE_PRIMARY:${product.id}`);
      plan.detected.push(detail);
      continue;
    }
    const current = approvedPrimary[0] || null;
    let detail;
    if (current && exactTarget(current, proposal)) {
      detail = productDetail(product, "ALREADY_CLASSIFIED", proposal, current);
      plan.alreadyClassified.push(detail);
    } else if (current?.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.MANUAL
      || current?.approvalStatus === CUSTOMER_APPROVAL_STATUS.MANUAL_APPROVED) {
      detail = productDetail(product, "PRESERVED_MANUAL", proposal, current);
      plan.preservedManual.push(detail);
    } else if (current && exactSafeRoot(current)) {
      detail = productDetail(product, "UPGRADE_SAFE_ROOT", proposal, current);
      plan.upgradeSafeRoot.push(detail);
      plan.outstanding.push(detail);
    } else if (current) {
      detail = productDetail(product, "OTHER_APPROVED_PRIMARY", proposal, current);
      plan.conflicts.push(detail);
    } else if (rows.some((membership) => (
      membership.categorySlug === WINDSHIELD_CATEGORY
      && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.REJECTED
    ))) {
      detail = productDetail(product, "REJECTED_TARGET_PRESERVED", proposal);
      plan.conflicts.push(detail);
    } else {
      detail = productDetail(product, "INSERT", proposal);
      plan.insert.push(detail);
      plan.outstanding.push(detail);
    }
    plan.detected.push(detail);
  }
  plan.detected.sort((a, b) => a.productId - b.productId);
  plan.outstanding.sort((a, b) => a.productId - b.productId);
  return plan;
}

function createReport({ mode, expectedCount, plan, verification = null }) {
  return {
    mode,
    expectedCount,
    detectedCount: plan.detected.length,
    outstandingCount: plan.outstanding.length,
    insertCount: plan.insert.length,
    upgradeSafeRootCount: plan.upgradeSafeRoot.length,
    alreadyClassifiedCount: plan.alreadyClassified.length,
    preservedManualCount: plan.preservedManual.length,
    conflictCount: plan.conflicts.length,
    idempotentNoop: plan.outstanding.length === 0 && plan.alreadyClassified.length > 0,
    candidates: plan.detected,
    conflicts: plan.conflicts,
    errors: [...plan.errors],
    applied: 0,
    verification,
  };
}

export async function runWindshieldBackfill({
  mode = "DRY_RUN",
  confirmation = null,
  expectedCount = null,
  dbPool = pool,
  repository = CustomerTaxonomyRepository,
  assignmentService = CustomerTaxonomyAssignmentService,
} = {}) {
  if (!["DRY_RUN", "APPLY"].includes(mode)) throw new Error(`Unsupported mode: ${mode}`);
  if (mode === "APPLY" && confirmation !== WINDSHIELD_BACKFILL_CONFIRMATION) {
    throw new Error(`APPLY requires confirmation ${WINDSHIELD_BACKFILL_CONFIRMATION}`);
  }
  if (mode === "APPLY" && !Number.isSafeInteger(expectedCount)) {
    throw new Error("APPLY requires expectedCount from the reviewed dry-run");
  }

  const client = typeof dbPool.connect === "function" ? await dbPool.connect() : dbPool;
  const release = client !== dbPool && typeof client.release === "function";
  let transactionOpen = false;
  let report = null;
  try {
    await client.query(mode === "APPLY"
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
      : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const products = await repository.listProductsForPreview(client);
    const rules = await repository.listActiveRules(client);
    let memberships = await repository.listMemberships(client);
    let plan = buildWindshieldBackfillPlan({ products, memberships, rules });
    report = createReport({ mode, expectedCount, plan });
    const globalBefore = await repository.getBackfillVerification(client);
    if (globalBefore.duplicatePrimary !== 0) {
      report.errors.push(`GLOBAL_DUPLICATE_PRIMARY:${globalBefore.duplicatePrimary}`);
    }
    if (mode === "DRY_RUN") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return report;
    }
    if (!report.idempotentNoop && plan.outstanding.length !== expectedCount) {
      report.errors.push(`EXPECTED_COUNT_MISMATCH:${expectedCount}:${plan.outstanding.length}`);
    }
    if (report.errors.length) {
      throw new CustomerTaxonomyWindshieldBackfillError("Windshield backfill preflight failed", report);
    }
    if (report.idempotentNoop) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return report;
    }

    for (const target of plan.outstanding) {
      await repository.lockProductForAssignment(target.productId, client);
      const product = await repository.findProductForResolution(target.productId, client);
      const currentMemberships = await repository.listMembershipsForProduct(
        target.productId,
        client,
        { lock: true },
      );
      const currentPlan = buildWindshieldBackfillPlan({
        products: [product],
        memberships: currentMemberships,
        rules,
      });
      const current = currentPlan.outstanding[0];
      if (!current || current.state !== target.state) {
        report.errors.push(`CANDIDATE_CHANGED:${target.productId}`);
        break;
      }
      const resolution = resolveCustomerTaxonomy({
        product,
        rules,
        existingMemberships: currentMemberships,
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
      });
      const assignment = await assignmentService.applyResolutionInTransaction({
        productId: target.productId,
        resolution,
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
        allowApprovedPrimaryReplacement: target.state === "UPGRADE_SAFE_ROOT",
        approvedPrimaryReplacementReason: target.state === "UPGRADE_SAFE_ROOT"
          ? "Reviewed EPC67 windshield leaf upgrade"
          : null,
      }, { db: client, repository });
      if (!assignment.applied.some((membership) => (
        membership.isPrimary && membership.customerCategoryId === resolution.proposals[0]?.category?.id
      ))) {
        report.errors.push(`APPLY_FAILED:${target.productId}:${assignment.decision}`);
        break;
      }
      report.applied += 1;
    }

    memberships = await repository.listMemberships(client);
    plan = buildWindshieldBackfillPlan({ products, memberships, rules });
    const globalAfter = await repository.getBackfillVerification(client);
    report.verification = {
      remainingOutstanding: plan.outstanding.length,
      classified: plan.alreadyClassified.length,
      duplicatePrimary: globalAfter.duplicatePrimary,
      orphanRule: globalAfter.orphanRule,
      inactiveTarget: globalAfter.inactiveTarget,
    };
    if (report.applied !== expectedCount) {
      report.errors.push(`APPLIED_COUNT_MISMATCH:${expectedCount}:${report.applied}`);
    }
    if (plan.outstanding.length !== 0) {
      report.errors.push(`OUTSTANDING_AFTER_APPLY:${plan.outstanding.length}`);
    }
    if (globalAfter.duplicatePrimary !== 0 || globalAfter.orphanRule !== 0 || globalAfter.inactiveTarget !== 0) {
      report.errors.push("GLOBAL_INTEGRITY_FAILED");
    }
    if (report.errors.length) {
      throw new CustomerTaxonomyWindshieldBackfillError("Windshield backfill verification failed", report);
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return report;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    if (error instanceof CustomerTaxonomyWindshieldBackfillError || !report) throw error;
    throw new CustomerTaxonomyWindshieldBackfillError(error.message, report);
  } finally {
    if (release) client.release();
  }
}

export const CustomerTaxonomyWindshieldBackfillService = {
  run: runWindshieldBackfill,
};
