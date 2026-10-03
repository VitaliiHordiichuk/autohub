import { pool } from "../config/db.js";
import { CustomerTaxonomyRepository } from "../repositories/CustomerTaxonomyRepository.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_ASSIGNMENT_SOURCE,
} from "./CustomerTaxonomyResolver.js";

const validOrigins = new Set(Object.values(CUSTOMER_ASSIGNMENT_ORIGIN));

function assertOrigin(origin) {
  if (!validOrigins.has(origin)) {
    throw new Error(`Unsupported customer taxonomy assignment origin: ${origin}`);
  }
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
  }, { dbPool = pool, repository = CustomerTaxonomyRepository } = {}) {
    assertOrigin(assignmentOrigin);
    return withTransaction(dbPool, async (db) => {
      const existing = await repository.listMembershipsForProduct(
        productId,
        db,
        { lock: true },
      );
      const hasManualPrimary = existing.some((membership) => (
        membership.isPrimary
        && membership.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.MANUAL
        && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.MANUAL_APPROVED
      ));
      const applied = [];

      for (const proposal of resolution?.proposals || []) {
        const manualSameCategory = existing.some((membership) => (
          membership.customerCategoryId === proposal.category.id
          && membership.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.MANUAL
        ));
        if (manualSameCategory) continue;

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

      return {
        productId,
        manualPrimaryPreserved: hasManualPrimary,
        applied,
      };
    });
  },
};
