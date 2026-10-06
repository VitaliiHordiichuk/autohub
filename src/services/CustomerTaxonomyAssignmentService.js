import { pool } from "../config/db.js";
import { CustomerTaxonomyRepository } from "../repositories/CustomerTaxonomyRepository.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_ASSIGNMENT_SOURCE,
  CUSTOMER_TAXONOMY_DECISION,
  evaluateExistingApprovedPrimary,
} from "./CustomerTaxonomyResolver.js";

const validOrigins = new Set(Object.values(CUSTOMER_ASSIGNMENT_ORIGIN));

function assertOrigin(origin) {
  if (!validOrigins.has(origin)) {
    throw new Error(`Unsupported customer taxonomy assignment origin: ${origin}`);
  }
}

function assertReplacementOverride({
  allowApprovedPrimaryReplacement,
  approvedPrimaryReplacementReason,
}) {
  if (
    allowApprovedPrimaryReplacement
    && !String(approvedPrimaryReplacementReason || "").trim()
  ) {
    throw new Error(
      "Approved primary replacement requires approvedPrimaryReplacementReason",
    );
  }
}

function assignedDecision(applied, rejectedPreserved, explicitReplacement) {
  if (explicitReplacement && applied.some((membership) => membership.isPrimary)) {
    return CUSTOMER_TAXONOMY_DECISION.REPLACED_BY_EXPLICIT_OVERRIDE;
  }
  const primary = applied.find((membership) => membership.isPrimary);
  if (
    primary?.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.RULE
    && primary.confidence === "HIGH"
  ) return CUSTOMER_TAXONOMY_DECISION.ASSIGNED_NEW_HIGH;
  if (
    primary?.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK
  ) return CUSTOMER_TAXONOMY_DECISION.ASSIGNED_SAFE;
  if (applied.some((membership) => (
    membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.REVIEW
  ))) return CUSTOMER_TAXONOMY_DECISION.REQUIRES_REVIEW;
  if (rejectedPreserved.length) return CUSTOMER_TAXONOMY_DECISION.PRESERVED_REJECTED;
  return CUSTOMER_TAXONOMY_DECISION.NO_ACTION;
}

async function withTransaction(dbPool, work) {
  const client = typeof dbPool.connect === "function"
    ? await dbPool.connect()
    : dbPool;
  const release = client !== dbPool && typeof client.release === "function";
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const result = await work(client);
    await client.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (release) client.release();
  }
}

export const CustomerTaxonomyAssignmentService = {
  async assignManual({
    productId,
    customerCategoryId,
    isPrimary = true,
    approvedBy,
  }, { dbPool = pool, repository = CustomerTaxonomyRepository } = {}) {
    return withTransaction(dbPool, async (db) => {
      await repository.lockProductForAssignment?.(productId, db);
      await repository.listMembershipsForProduct(productId, db, { lock: true });
      if (isPrimary) await repository.demoteAllPrimary(productId, db);
      return repository.upsertMembership({
        productId,
        customerCategoryId,
        isPrimary,
        assignmentSource: CUSTOMER_ASSIGNMENT_SOURCE.MANUAL,
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.ADMIN,
        confidence: "HIGH",
        approvalStatus: CUSTOMER_APPROVAL_STATUS.MANUAL_APPROVED,
        approvedBy,
      }, db);
    });
  },

  async applyResolution({
    productId,
    resolution,
    assignmentOrigin = CUSTOMER_ASSIGNMENT_ORIGIN.SYSTEM,
    allowApprovedPrimaryReplacement = false,
    approvedPrimaryReplacementReason = null,
  }, { dbPool = pool, repository = CustomerTaxonomyRepository } = {}) {
    assertOrigin(assignmentOrigin);
    assertReplacementOverride({
      allowApprovedPrimaryReplacement,
      approvedPrimaryReplacementReason,
    });
    return withTransaction(dbPool, (db) => (
      CustomerTaxonomyAssignmentService.applyResolutionInTransaction({
        productId,
        resolution,
        assignmentOrigin,
        allowApprovedPrimaryReplacement,
        approvedPrimaryReplacementReason,
      }, { db, repository })
    ));
  },

  async applyResolutionInTransaction({
    productId,
    resolution,
    assignmentOrigin = CUSTOMER_ASSIGNMENT_ORIGIN.SYSTEM,
    allowApprovedPrimaryReplacement = false,
    approvedPrimaryReplacementReason = null,
  }, { db, repository = CustomerTaxonomyRepository } = {}) {
    assertOrigin(assignmentOrigin);
    assertReplacementOverride({
      allowApprovedPrimaryReplacement,
      approvedPrimaryReplacementReason,
    });
    if (!db) throw new Error("Customer taxonomy transaction client is required");
    await repository.lockProductForAssignment?.(productId, db);
    const existing = await repository.listMembershipsForProduct(
      productId,
      db,
      { lock: true },
    );
    const existingPrimaryDecision = evaluateExistingApprovedPrimary(existing);
    const hasManualPrimary = existingPrimaryDecision.manual
      && existingPrimaryDecision.approved;
    const applied = [];
    const rejectedPreserved = [];

    if (existingPrimaryDecision.decision === CUSTOMER_TAXONOMY_DECISION.INVALID_EXISTING_PRIMARY) {
      return {
        productId,
        decision: CUSTOMER_TAXONOMY_DECISION.INVALID_EXISTING_PRIMARY,
        decisionIssues: existingPrimaryDecision.issues,
        manualPrimaryPreserved: hasManualPrimary,
        preservedApprovedPrimary: null,
        rejectedPreserved,
        applied,
      };
    }
    if (existingPrimaryDecision.decision === CUSTOMER_TAXONOMY_DECISION.PRESERVE_MANUAL) {
      return {
        productId,
        decision: CUSTOMER_TAXONOMY_DECISION.PRESERVE_MANUAL,
        decisionIssues: [],
        manualPrimaryPreserved: true,
        preservedApprovedPrimary: existingPrimaryDecision.existingPrimary,
        rejectedPreserved,
        applied,
      };
    }
    if (
      existingPrimaryDecision.decision
        === CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY
      && !allowApprovedPrimaryReplacement
    ) {
      return {
        productId,
        decision: CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
        decisionIssues: [],
        manualPrimaryPreserved: false,
        preservedApprovedPrimary: existingPrimaryDecision.existingPrimary,
        rejectedPreserved,
        applied,
      };
    }

    for (const proposal of resolution?.proposals || []) {
      const sameCategory = existing.find((membership) => (
        membership.customerCategoryId === proposal.category.id
      ));
      if (sameCategory?.approvalStatus === CUSTOMER_APPROVAL_STATUS.REJECTED) {
        rejectedPreserved.push(sameCategory);
        continue;
      }
      if (sameCategory?.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.MANUAL) {
        continue;
      }

      const isPrimary = Boolean(proposal.isPrimary) && !hasManualPrimary;
      if (isPrimary) await repository.demoteAutomaticPrimary(productId, db);
      applied.push(await repository.upsertMembership({
        productId,
        customerCategoryId: proposal.category.id,
        isPrimary,
        assignmentSource: proposal.assignmentSource,
        assignmentOrigin,
        ruleCode: proposal.ruleCode,
        ruleVersion: proposal.ruleVersion,
        confidence: proposal.confidence,
        approvalStatus: proposal.approvalStatus,
      }, db));
    }

    const explicitReplacement = allowApprovedPrimaryReplacement
      && existingPrimaryDecision.valid
      && !existingPrimaryDecision.manual;
    return {
      productId,
      decision: assignedDecision(applied, rejectedPreserved, explicitReplacement),
      decisionIssues: [],
      approvedPrimaryReplacementReason: explicitReplacement
        ? String(approvedPrimaryReplacementReason).trim()
        : null,
      manualPrimaryPreserved: hasManualPrimary,
      preservedApprovedPrimary: null,
      rejectedPreserved,
      applied,
    };
  },
};
