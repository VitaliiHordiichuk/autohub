import { pool } from "../config/db.js";
import { CustomerTaxonomyRepository } from "../repositories/CustomerTaxonomyRepository.js";
import { CustomerTaxonomyAssignmentService } from "./CustomerTaxonomyAssignmentService.js";
import { CustomerTaxonomyImportService } from "./CustomerTaxonomyImportService.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_ASSIGNMENT_SOURCE,
} from "./CustomerTaxonomyResolver.js";

export const UNCATEGORIZED_BACKFILL_APPLY_CONFIRMATION = "APPLY_REVIEWED_UNCATEGORIZED_PLAN";
export const UNCATEGORIZED_BACKFILL_RESTORE_CONFIRMATION = "RESTORE_UNCATEGORIZED_PLAN";
const MAX_PREVIEW = 250;
const MAX_APPLY = 25;
// HIGH classification is not OEM verification. These three existing products
// must stay out of an APPLY plan until their part identity is checked separately.
const pendingOemVerificationArticles = new Set([
  "A1635401417",
  "A270094000490",
  "B66959719",
]);

export function requiresOemVerificationBeforeBackfill(article) {
  return pendingOemVerificationArticles.has(String(article || "").trim().toUpperCase());
}

function positiveInteger(value, label, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${label} must be an integer from 1 to ${maximum}`);
  }
  return number;
}

function validatePlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0 || plan.length > MAX_APPLY) {
    throw new Error(`Plan must contain 1 to ${MAX_APPLY} candidates`);
  }
  const ids = new Set();
  for (const item of plan) {
    if (!Number.isSafeInteger(item.productId) || item.productId < 1) {
      throw new Error("Plan productId must be a positive integer");
    }
    if (ids.has(item.productId)) throw new Error("Duplicate productId in plan");
    ids.add(item.productId);
    if (!item.article || !item.categorySlug || !item.ruleCode
      || !Number.isInteger(item.ruleVersion) || item.ruleVersion < 1) {
      throw new Error(`Incomplete HIGH rule plan for product ${item.productId}`);
    }
  }
}

function describe(evaluation, memberships) {
  const { product, resolution, disposition, candidate } = evaluation;
  const highRule = candidate
    && candidate.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.RULE
    && candidate.confidence === "HIGH"
    && candidate.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED;
  const requiresReview = disposition.requiresReview
    || resolution.proposals.some((proposal) => (
      proposal.approvalStatus === CUSTOMER_APPROVAL_STATUS.REVIEW
    ));
  let status = highRule ? "AUTO_HIGH" : requiresReview || candidate ? "REVIEW" : "UNKNOWN";
  if (highRule && requiresOemVerificationBeforeBackfill(product.article)) {
    status = "REVIEW_OEM";
  }
  if (memberships.length) status = "REVIEW_EXISTING_MEMBERSHIP";
  return {
    productId: product.id,
    article: product.article,
    name: product.name,
    technicalEpc: product.technicalEpcGroups,
    detectedTypeCodes: resolution.typeCodes,
    status,
    categorySlug: candidate?.category.slug || null,
    confidence: candidate?.confidence || null,
    ruleCode: candidate?.ruleCode || null,
    ruleVersion: candidate?.ruleVersion || null,
    reason: memberships.length
      ? "Existing membership requires individual review"
      : status === "REVIEW_OEM" ? "OEM part verification required before backfill"
      : disposition.reason || (highRule ? "Reviewed HIGH rule" : "No approved leaf rule"),
  };
}

async function evaluate(productId, { db, repository, taxonomyService, context }) {
  const product = await repository.findProductForResolution(productId, db);
  if (!product) throw new Error(`Product ${productId} not found`);
  if (product.isActive === false) throw new Error(`Product ${productId} is inactive`);
  const memberships = await repository.listMembershipsForProduct(productId, db, { lock: false });
  const evaluation = await taxonomyService.evaluateProduct({
    product,
    existingMemberships: memberships,
    context,
  }, { db, repository, assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL });
  return { evaluation, memberships, row: describe(evaluation, memberships) };
}

function exactPlanMatch(item, row) {
  return row.status === "AUTO_HIGH"
    && row.article === item.article
    && row.categorySlug === item.categorySlug
    && row.ruleCode === item.ruleCode
    && row.ruleVersion === item.ruleVersion;
}

export async function runUncategorizedBackfill({
  mode = "DRY_RUN",
  afterId = 0,
  limit = 100,
  plan = null,
  confirmation = null,
  dbPool = pool,
  repository = CustomerTaxonomyRepository,
  taxonomyService = CustomerTaxonomyImportService,
  assignmentService = CustomerTaxonomyAssignmentService,
} = {}) {
  if (!["DRY_RUN", "APPLY", "RESTORE"].includes(mode)) throw new Error("Invalid backfill mode");
  if (mode === "DRY_RUN") {
    if (!Number.isSafeInteger(Number(afterId)) || Number(afterId) < 0) {
      throw new Error("afterId must be a non-negative integer");
    }
    positiveInteger(limit, "limit", MAX_PREVIEW);
  } else {
    validatePlan(plan);
    const required = mode === "APPLY"
      ? UNCATEGORIZED_BACKFILL_APPLY_CONFIRMATION
      : UNCATEGORIZED_BACKFILL_RESTORE_CONFIRMATION;
    if (confirmation !== required) throw new Error(`Missing confirmation: ${required}`);
  }

  const db = await dbPool.connect();
  let transactionOpen = false;
  try {
    await db.query(mode === "DRY_RUN" ? "BEGIN READ ONLY" : "BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    if (mode === "RESTORE") {
      const restored = [];
      for (const item of plan) {
        await repository.lockProductForAssignment(item.productId, db);
        const memberships = await repository.listMembershipsForProduct(item.productId, db, { lock: true });
        const membership = memberships[0];
        if (memberships.length !== 1
          || membership.categorySlug !== item.categorySlug
          || membership.assignmentOrigin !== CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL
          || membership.assignmentSource !== CUSTOMER_ASSIGNMENT_SOURCE.RULE
          || membership.ruleCode !== item.ruleCode
          || membership.ruleVersion !== item.ruleVersion
          || membership.approvalStatus !== CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
          || membership.isPrimary !== true) {
          throw new Error(`Restore guard failed for product ${item.productId}`);
        }
        const deleted = await db.query(`
          DELETE FROM product_customer_categories
          WHERE product_id = $1 AND customer_category_id = $2
            AND assignment_origin = 'BACKFILL' AND assignment_source = 'RULE'
            AND rule_code = $3 AND rule_version = $4 AND is_primary = TRUE
        `, [item.productId, membership.customerCategoryId, item.ruleCode, item.ruleVersion]);
        if (deleted.rowCount !== 1) throw new Error(`Restore delete failed for product ${item.productId}`);
        restored.push(item.productId);
      }
      await db.query("COMMIT");
      transactionOpen = false;
      return { mode, restored };
    }

    const ids = mode === "DRY_RUN"
      ? (await db.query(`
          SELECT product.id FROM products product
          WHERE product.is_active IS DISTINCT FROM FALSE AND product.id > $1
            AND NOT EXISTS (
              SELECT 1 FROM product_customer_categories membership
              WHERE membership.product_id = product.id AND membership.is_primary = TRUE
                AND membership.approval_status IN ('AUTO_APPROVED', 'MANUAL_APPROVED')
            )
          ORDER BY product.id LIMIT $2
        `, [Number(afterId), Number(limit)])).rows.map((row) => Number(row.id))
      : plan.map((item) => item.productId);
    const context = await taxonomyService.createContext({ db, repository });
    const rows = [];
    for (const id of ids) {
      if (mode === "APPLY") await repository.lockProductForAssignment(id, db);
      const result = await evaluate(id, { db, repository, taxonomyService, context });
      rows.push(result.row);
      if (mode === "APPLY") {
        const item = plan.find((candidate) => candidate.productId === id);
        if (!exactPlanMatch(item, result.row)) throw new Error(`Stale backfill plan for product ${id}`);
        const assignment = await assignmentService.applyResolutionInTransaction({
          productId: id,
          resolution: { proposals: [result.evaluation.candidate] },
          assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
        }, { db, repository });
        if (assignment.applied.length !== 1 || !assignment.applied[0].isPrimary) {
          throw new Error(`Backfill assignment failed for product ${id}`);
        }
      }
    }
    if (mode === "DRY_RUN") {
      await db.query("ROLLBACK");
      transactionOpen = false;
      return {
        mode,
        rows,
        counts: {
          autoHigh: rows.filter((row) => row.status === "AUTO_HIGH").length,
          review: rows.filter((row) => row.status.startsWith("REVIEW")).length,
          unknown: rows.filter((row) => row.status === "UNKNOWN").length,
        },
        nextAfterId: ids.at(-1) || Number(afterId),
        plan: rows.filter((row) => row.status === "AUTO_HIGH").map((row) => ({
          productId: row.productId,
          article: row.article,
          categorySlug: row.categorySlug,
          ruleCode: row.ruleCode,
          ruleVersion: row.ruleVersion,
        })),
      };
    }
    await db.query("COMMIT");
    transactionOpen = false;
    return { mode, applied: ids };
  } catch (error) {
    if (transactionOpen) await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
