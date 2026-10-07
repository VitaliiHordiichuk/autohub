import { pool } from "../config/db.js";
import {
  CustomerTaxonomyPhase3FAccessoriesBackfillRepository,
} from "../repositories/CustomerTaxonomyPhase3FAccessoriesBackfillRepository.js";
import { CustomerTaxonomyAssignmentService } from "./CustomerTaxonomyAssignmentService.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_ASSIGNMENT_SOURCE,
  CUSTOMER_TAXONOMY_DECISION,
} from "./CustomerTaxonomyResolver.js";

export const PHASE3F6_ACCESSORIES_CONFIRMATION = "PHASE3F6_ACCESSORIES_ALLOWLIST";
export const PHASE3F6_ACCESSORIES_TARGET_CATEGORY = "accessories";
export const PHASE3F6_ACCESSORIES_EXPECTED_COUNT = 32;

function allow(productId, article, epc) {
  return Object.freeze({ productId, article, epc });
}

export const PHASE3F6_ACCESSORIES_ALLOWLIST = Object.freeze([
  allow(385, "A2045843782Z122", "58"),
  allow(386, "A1765840281Z122", "58"),
  allow(387, "A2215840196Z122", "58"),
  allow(443, "A2465841271", "58"),
  allow(491, "A4635849982", "58"),
  allow(623, "A1645845293", "58"),
  allow(806, "A0005837505", "58"),
  allow(1222, "A1675845719", "58"),
  allow(1298, "A639581011764", "58"),
  allow(1754, "A0005836203", "58"),
  allow(1755, "A0005836503", "58"),
  allow(2241, "A2055840921", "58"),
  allow(2245, "A4635846703", "58"),
  allow(2246, "A1675849006Z131", "58"),
  allow(2630, "A904581000164", "58"),
  allow(2634, "A0005810000", "58"),
  allow(2635, "A221581000164", "58"),
  allow(2638, "A169581010164", "58"),
  allow(2642, "A1725840000Z122", "58"),
  allow(2643, "A2135843216Z131", "58"),
  allow(2874, "A0005831502", "58"),
  allow(3189, "A4635842803", "58"),
  allow(3580, "A000583340364", "58"),
  allow(4251, "A000580100064", "58"),
  allow(4415, "A4145810049", "58"),
  allow(4560, "A1715848993", "58"),
  allow(4562, "A2465840293Z122", "58"),
  allow(4686, "A1675800200", "58"),
  allow(4687, "A2055850000", "58"),
  allow(6455, "A0005832102", "58"),
  allow(4274, "A4478400300", "84"),
  allow(6062, "A2038400020", "84"),
]);

const canonicalAllowlistById = new Map(
  PHASE3F6_ACCESSORIES_ALLOWLIST.map((entry) => [entry.productId, entry]),
);

const approvedStatuses = new Set([
  CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED,
  CUSTOMER_APPROVAL_STATUS.MANUAL_APPROVED,
]);

export class CustomerTaxonomyPhase3FAccessoriesBackfillError extends Error {
  constructor(message, report = null) {
    super(message);
    this.name = "CustomerTaxonomyPhase3FAccessoriesBackfillError";
    this.report = report;
  }
}

export function parsePhase3FAccessoriesBackfillArguments(argumentsList = []) {
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
  if (mode === "APPLY" && confirmation !== PHASE3F6_ACCESSORIES_CONFIRMATION) {
    throw new Error(`--apply requires --confirm=${PHASE3F6_ACCESSORIES_CONFIRMATION}`);
  }
  return { mode, confirmation };
}

function uniqueErrors(errors) {
  return [...new Set(errors)];
}

function membershipByProduct(memberships) {
  const result = new Map();
  for (const membership of memberships) {
    const list = result.get(membership.productId) || [];
    list.push(membership);
    result.set(membership.productId, list);
  }
  return result;
}

function approvedPrimary(memberships) {
  return memberships.find((membership) => (
    membership.isPrimary === true
    && approvedStatuses.has(membership.approvalStatus)
  )) || null;
}

function exactTargetProvenance(membership, categoryId) {
  return membership?.customerCategoryId === categoryId
    && membership.isPrimary === true
    && membership.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK
    && membership.assignmentOrigin === CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL
    && membership.ruleCode === null
    && membership.ruleVersion === null
    && membership.confidence === "MEDIUM"
    && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED;
}

function exactTargetMembership(membership, categoryId) {
  return exactTargetProvenance(membership, categoryId)
    && membership.categorySlug === PHASE3F6_ACCESSORIES_TARGET_CATEGORY
    && membership.parentSlug === null;
}

function validRootCategory(category) {
  return Boolean(category)
    && category.slug === PHASE3F6_ACCESSORIES_TARGET_CATEGORY
    && category.parentId === null
    && category.status === "ACTIVE"
    && category.isActive === true;
}

function safeProposal(category) {
  return {
    category: {
      id: category.id,
      slug: category.slug,
      parentSlug: null,
    },
    isPrimary: true,
    assignmentSource: CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK,
    assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
    ruleCode: null,
    ruleVersion: null,
    confidence: "MEDIUM",
    approvalStatus: CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED,
  };
}

function validateAllowlistShape(report, allowlist) {
  const ids = new Set();
  const articles = new Set();
  for (const entry of allowlist) {
    if (ids.has(entry.productId)) report.errors.push(`DUPLICATE_ALLOWLIST_ID:${entry.productId}`);
    if (articles.has(entry.article)) report.errors.push(`DUPLICATE_ALLOWLIST_ARTICLE:${entry.article}`);
    if (!["58", "84"].includes(String(entry.epc))) {
      report.errors.push(`UNEXPECTED_ALLOWLIST_EPC:${entry.productId}:${entry.epc}`);
    }
    const canonical = canonicalAllowlistById.get(entry.productId);
    if (
      !canonical
      || canonical.article !== entry.article
      || canonical.epc !== entry.epc
    ) {
      report.errors.push(`ALLOWLIST_TUPLE_MISMATCH:${entry.productId}`);
    }
    ids.add(entry.productId);
    articles.add(entry.article);
  }
  for (const canonical of PHASE3F6_ACCESSORIES_ALLOWLIST) {
    if (!ids.has(canonical.productId)) {
      report.errors.push(`ALLOWLIST_TUPLE_MISSING:${canonical.productId}`);
    }
  }
}

function scanAllowlist({ allowlist, products, memberships, category }) {
  const report = {
    expectedCandidates: PHASE3F6_ACCESSORIES_EXPECTED_COUNT,
    productsFound: products.length,
    candidates: [],
    alreadyApplied: [],
    invalid: [],
    idempotentNoop: false,
    errors: [],
  };
  validateAllowlistShape(report, allowlist);
  if (allowlist.length !== PHASE3F6_ACCESSORIES_EXPECTED_COUNT) {
    report.errors.push(
      `ALLOWLIST_COUNT:${PHASE3F6_ACCESSORIES_EXPECTED_COUNT}:${allowlist.length}`,
    );
  }
  if (!validRootCategory(category)) {
    report.errors.push(`INVALID_TARGET_CATEGORY:${PHASE3F6_ACCESSORIES_TARGET_CATEGORY}`);
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const membershipsByProduct = membershipByProduct(memberships);

  for (const expected of allowlist) {
    const product = productById.get(expected.productId) || null;
    const rows = membershipsByProduct.get(expected.productId) || [];
    const detail = {
      ...expected,
      actualArticle: product?.articleNormalized ?? null,
      actualEpcGroups: product?.technicalEpcGroups || [],
      state: "INVALID",
    };
    if (!product) {
      report.errors.push(`MISSING_PRODUCT:${expected.productId}:${expected.article}`);
      report.invalid.push(detail);
      continue;
    }
    if (product.isActive !== true) {
      report.errors.push(`INACTIVE_PRODUCT:${expected.productId}:${expected.article}`);
      report.invalid.push(detail);
      continue;
    }
    if (product.articleNormalized !== expected.article) {
      report.errors.push(
        `ARTICLE_MISMATCH:${expected.productId}:${expected.article}:${product.articleNormalized}`,
      );
      report.invalid.push(detail);
      continue;
    }
    if (!product.technicalEpcGroups.includes(expected.epc)) {
      report.errors.push(`EPC_MISMATCH:${expected.productId}:${expected.article}:${expected.epc}`);
      report.invalid.push(detail);
      continue;
    }
    const primaryCount = rows.filter((membership) => membership.isPrimary).length;
    if (primaryCount > 1) {
      report.errors.push(`DUPLICATE_PRIMARY:${expected.productId}:${primaryCount}`);
      report.invalid.push(detail);
      continue;
    }
    const exact = rows.find((membership) => (
      exactTargetMembership(membership, category?.id)
    )) || null;
    if (exact) {
      detail.state = "ALREADY_APPLIED";
      report.alreadyApplied.push(detail);
      continue;
    }
    const existingApprovedPrimary = approvedPrimary(rows);
    if (existingApprovedPrimary) {
      report.errors.push(
        `APPROVED_PRIMARY_PRESENT:${expected.productId}:${existingApprovedPrimary.categorySlug}`,
      );
      report.invalid.push(detail);
      continue;
    }
    if (!validRootCategory(category)) {
      report.invalid.push(detail);
      continue;
    }
    detail.state = "CANDIDATE";
    report.candidates.push(detail);
  }

  if (report.candidates.length && report.alreadyApplied.length) {
    report.errors.push(
      `PARTIAL_TARGET_STATE:${report.candidates.length}:${report.alreadyApplied.length}`,
    );
  }
  report.idempotentNoop = report.candidates.length === 0
    && report.alreadyApplied.length === PHASE3F6_ACCESSORIES_EXPECTED_COUNT
    && report.invalid.length === 0;
  if (
    !report.idempotentNoop
    && report.candidates.length !== PHASE3F6_ACCESSORIES_EXPECTED_COUNT
  ) {
    report.errors.push(
      `EXPECTED_CANDIDATE_COUNT:${PHASE3F6_ACCESSORIES_EXPECTED_COUNT}:${report.candidates.length}`,
    );
  }
  report.errors = uniqueErrors(report.errors);
  return report;
}

function verifyAllowlist({ allowlist, products, memberships, category }) {
  const membershipsByProduct = membershipByProduct(memberships);
  let correctTarget = 0;
  let duplicatePrimary = 0;
  for (const entry of allowlist) {
    const rows = membershipsByProduct.get(entry.productId) || [];
    if (rows.filter((membership) => membership.isPrimary).length > 1) {
      duplicatePrimary += 1;
    }
    if (rows.some((membership) => exactTargetMembership(membership, category.id))) {
      correctTarget += 1;
    }
  }
  return {
    products: products.length,
    correctTarget,
    duplicatePrimary,
  };
}

export async function runPhase3FAccessoriesBackfill({
  mode = "DRY_RUN",
  confirmation = null,
  allowlist = PHASE3F6_ACCESSORIES_ALLOWLIST,
  dbPool = pool,
  repository = CustomerTaxonomyPhase3FAccessoriesBackfillRepository,
  assignmentService = CustomerTaxonomyAssignmentService,
} = {}) {
  if (!["DRY_RUN", "APPLY"].includes(mode)) {
    throw new Error(`Unsupported PHASE 3F.6 accessories backfill mode: ${mode}`);
  }
  if (mode === "APPLY" && confirmation !== PHASE3F6_ACCESSORIES_CONFIRMATION) {
    throw new Error(`APPLY requires confirmation ${PHASE3F6_ACCESSORIES_CONFIRMATION}`);
  }

  const client = typeof dbPool.connect === "function"
    ? await dbPool.connect()
    : dbPool;
  const release = client !== dbPool && typeof client.release === "function";
  let transactionOpen = false;
  let report = null;
  const productIds = allowlist.map((entry) => entry.productId);

  try {
    await client.query(mode === "APPLY"
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
      : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    if (mode === "APPLY") {
      await repository.lockAllowlistedProducts(productIds, client);
    }

    const products = await repository.listAllowlistedProducts(productIds, client);
    const memberships = await repository.listMembershipsForProducts(
      productIds,
      client,
      { lock: mode === "APPLY" },
    );
    const category = await repository.getCategoryBySlug(
      PHASE3F6_ACCESSORIES_TARGET_CATEGORY,
      client,
    );
    const preflight = scanAllowlist({ allowlist, products, memberships, category });
    const globalBefore = await repository.getGlobalIntegrity(client);
    if (globalBefore.duplicatePrimary !== 0) {
      preflight.errors.push(`GLOBAL_DUPLICATE_PRIMARY:${globalBefore.duplicatePrimary}`);
    }
    preflight.errors = uniqueErrors(preflight.errors);
    report = {
      mode,
      confirmationProvided: confirmation === PHASE3F6_ACCESSORIES_CONFIRMATION,
      targetCategory: PHASE3F6_ACCESSORIES_TARGET_CATEGORY,
      ...preflight,
      applied: { safe: 0, total: 0 },
      verification: null,
    };

    if (mode === "DRY_RUN") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return report;
    }
    if (report.errors.length) {
      throw new CustomerTaxonomyPhase3FAccessoriesBackfillError(
        "PHASE 3F.6 accessories backfill preflight failed",
        report,
      );
    }
    if (report.idempotentNoop) {
      report.verification = {
        products: products.length,
        correctTarget: report.alreadyApplied.length,
        duplicatePrimary: globalBefore.duplicatePrimary,
      };
      await client.query("ROLLBACK");
      transactionOpen = false;
      return report;
    }

    const proposal = safeProposal(category);
    for (const candidate of report.candidates) {
      const result = await assignmentService.applyResolutionInTransaction({
        productId: candidate.productId,
        resolution: { proposals: [proposal] },
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
      }, { db: client, repository });
      const applied = result.applied.find((membership) => (
        exactTargetProvenance(membership, category.id)
      ));
      if (result.decision !== CUSTOMER_TAXONOMY_DECISION.ASSIGNED_SAFE || !applied) {
        report.errors.push(
          `APPLY_RESULT_MISMATCH:${candidate.productId}:${result.decision}`,
        );
        break;
      }
      report.applied.safe += 1;
      report.applied.total += 1;
    }

    const membershipsAfter = await repository.listMembershipsForProducts(
      productIds,
      client,
      { lock: true },
    );
    report.verification = verifyAllowlist({
      allowlist,
      products,
      memberships: membershipsAfter,
      category,
    });
    const globalAfter = await repository.getGlobalIntegrity(client);
    if (globalAfter.duplicatePrimary !== 0) {
      report.errors.push(`GLOBAL_DUPLICATE_PRIMARY:${globalAfter.duplicatePrimary}`);
    }
    if (report.verification.duplicatePrimary !== 0) {
      report.errors.push(`TARGET_DUPLICATE_PRIMARY:${report.verification.duplicatePrimary}`);
    }
    if (report.verification.correctTarget !== PHASE3F6_ACCESSORIES_EXPECTED_COUNT) {
      report.errors.push(
        `VERIFIED_TARGET_COUNT:${PHASE3F6_ACCESSORIES_EXPECTED_COUNT}:${report.verification.correctTarget}`,
      );
    }
    if (
      report.applied.safe !== PHASE3F6_ACCESSORIES_EXPECTED_COUNT
      || report.applied.total !== PHASE3F6_ACCESSORIES_EXPECTED_COUNT
    ) {
      report.errors.push(
        `APPLIED_COUNT_MISMATCH:${report.applied.safe}:${report.applied.total}`,
      );
    }
    report.errors = uniqueErrors(report.errors);
    if (report.errors.length) {
      throw new CustomerTaxonomyPhase3FAccessoriesBackfillError(
        "PHASE 3F.6 accessories backfill verification failed",
        report,
      );
    }

    await client.query("COMMIT");
    transactionOpen = false;
    return report;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    if (
      error instanceof CustomerTaxonomyPhase3FAccessoriesBackfillError
      || !report
    ) throw error;
    throw new CustomerTaxonomyPhase3FAccessoriesBackfillError(error.message, report);
  } finally {
    if (release) client.release();
  }
}

export const CustomerTaxonomyPhase3FAccessoriesBackfillService = {
  run: runPhase3FAccessoriesBackfill,
};
