import { pool } from "../config/db.js";
import {
  CustomerTaxonomyPhase3CSteeringUpgradeRepository,
} from "../repositories/CustomerTaxonomyPhase3CSteeringUpgradeRepository.js";
import { detectCustomerProductTypes } from "./CustomerProductTypeDetector.js";
import {
  CUSTOMER_ASSIGNMENT_ORIGIN,
  resolveCustomerTaxonomy,
} from "./CustomerTaxonomyResolver.js";

export const PHASE3C_STEERING_ARTICLES = Object.freeze([
  "A0024662201",
  "A0024668801",
]);
export const PHASE3C_STEERING_CONFIRMATION = "PHASE3C_STEERING_PUMPS";
export const PHASE3C_STEERING_RULE = Object.freeze({
  code: "STEERING_PUMP_A_EPC46_V1",
  version: 8,
  detectorVersion: 10,
  typeCode: "STEERING_PUMP",
  epc: "46",
  currentCategory: "steering",
  targetCategory: "steering-pumps",
});

export class CustomerTaxonomyPhase3CSteeringUpgradeError extends Error {
  constructor(message, report = null) {
    super(message);
    this.name = "CustomerTaxonomyPhase3CSteeringUpgradeError";
    this.report = report;
  }
}

export function parsePhase3CSteeringUpgradeArguments(argumentsList = []) {
  let mode = "DRY_RUN";
  let expectedCount = 2;
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
      if (!/^\d+$/.test(raw)) {
        throw new Error("--expected-count must be a non-negative integer");
      }
      expectedCount = Number(raw);
      if (!Number.isSafeInteger(expectedCount)) {
        throw new Error("--expected-count is outside the safe integer range");
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (mode === "APPLY" && confirmation !== PHASE3C_STEERING_CONFIRMATION) {
    throw new Error(
      `--apply requires --confirm=${PHASE3C_STEERING_CONFIRMATION}`,
    );
  }
  return { mode, expectedCount, confirmation };
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

function exactCurrentMembership(membership) {
  return membership?.categorySlug === PHASE3C_STEERING_RULE.currentCategory
    && membership.isPrimary === true
    && membership.assignmentSource === "EPC_FALLBACK"
    && membership.ruleCode === null
    && membership.ruleVersion === null
    && membership.confidence === "MEDIUM"
    && membership.approvalStatus === "AUTO_APPROVED";
}

function exactTargetMembership(membership) {
  return membership?.categorySlug === PHASE3C_STEERING_RULE.targetCategory
    && membership.isPrimary === true
    && membership.assignmentSource === "RULE"
    && membership.assignmentOrigin === "BACKFILL"
    && membership.ruleCode === PHASE3C_STEERING_RULE.code
    && membership.ruleVersion === PHASE3C_STEERING_RULE.version
    && membership.confidence === "HIGH"
    && membership.approvalStatus === "AUTO_APPROVED";
}

function validateRuleAndCategory(report, category, rule) {
  if (!category) report.errors.push("MISSING_TARGET_CATEGORY:steering-pumps");
  else if (category.status !== "ACTIVE" || category.isActive !== true) {
    report.errors.push("INACTIVE_TARGET_CATEGORY:steering-pumps");
  }

  if (!rule) {
    report.errors.push(
      `MISSING_TARGET_RULE:${PHASE3C_STEERING_RULE.code}:${PHASE3C_STEERING_RULE.version}`,
    );
    return;
  }
  if (rule.isActive !== true) report.errors.push("INACTIVE_TARGET_RULE");
  if (rule.detectorVersion !== PHASE3C_STEERING_RULE.detectorVersion) {
    report.errors.push(`RULE_DETECTOR_VERSION:${rule.detectorVersion}`);
  }
  if (
    rule.targetCategorySlug !== PHASE3C_STEERING_RULE.targetCategory
    || rule.targetCategoryId !== category?.id
  ) report.errors.push("RULE_TARGET_MISMATCH");
  if (
    rule.sourceKind !== "RULE"
    || rule.assignmentRole !== "PRIMARY"
    || rule.matchType !== "TYPE_CODE"
    || rule.matchValue !== PHASE3C_STEERING_RULE.typeCode
    || rule.numberFamily !== "A"
    || String(rule.epcGroup) !== PHASE3C_STEERING_RULE.epc
    || rule.confidence !== "HIGH"
    || rule.autoApprovalAllowed !== true
  ) report.errors.push("UNSAFE_TARGET_RULE");
}

function verifyTargetState(products, memberships) {
  const byProduct = membershipByProduct(memberships);
  const verification = {
    targetCount: products.length,
    correctTarget: 0,
    wrongCategory: 0,
    wrongSource: 0,
    wrongConfidence: 0,
    wrongRule: 0,
    duplicatePrimary: 0,
    secondaryMemberships: 0,
  };
  for (const product of products) {
    const rows = byProduct.get(product.id) || [];
    const primary = rows.find((membership) => membership.isPrimary) || null;
    const primaryCount = rows.filter((membership) => membership.isPrimary).length;
    if (primaryCount > 1) verification.duplicatePrimary += 1;
    verification.secondaryMemberships += rows.filter((membership) => !membership.isPrimary).length;
    if (exactTargetMembership(primary) && rows.length === 1) {
      verification.correctTarget += 1;
      continue;
    }
    if (primary?.categorySlug !== PHASE3C_STEERING_RULE.targetCategory) {
      verification.wrongCategory += 1;
    }
    if (primary?.assignmentSource !== "RULE") verification.wrongSource += 1;
    if (primary?.confidence !== "HIGH") verification.wrongConfidence += 1;
    if (
      primary?.ruleCode !== PHASE3C_STEERING_RULE.code
      || primary?.ruleVersion !== PHASE3C_STEERING_RULE.version
    ) verification.wrongRule += 1;
  }
  return verification;
}

function addProductPreconditions({
  report,
  products,
  memberships,
  category,
  rule,
  detector,
  resolver,
}) {
  const productCountByArticle = new Map();
  for (const product of products) {
    productCountByArticle.set(
      product.articleNormalized,
      (productCountByArticle.get(product.articleNormalized) || 0) + 1,
    );
  }
  for (const article of PHASE3C_STEERING_ARTICLES) {
    const count = productCountByArticle.get(article) || 0;
    if (count !== 1) report.errors.push(`PRODUCT_COUNT:${article}:${count}`);
  }

  const byProduct = membershipByProduct(memberships);
  for (const product of products) {
    const rows = byProduct.get(product.id) || [];
    const detectedTypeCodes = detector(product);
    const resolution = resolver({
      product,
      rules: rule ? [rule] : [],
      existingMemberships: [],
      assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
    });
    const primary = resolution.proposals.find((proposal) => proposal.isPrimary) || null;
    const hasEpc = product.technicalEpcGroups.includes(PHASE3C_STEERING_RULE.epc);
    const detectorMatches = detectedTypeCodes.includes(PHASE3C_STEERING_RULE.typeCode);
    const resolverMatches = primary?.category?.slug === PHASE3C_STEERING_RULE.targetCategory
      && primary.ruleCode === PHASE3C_STEERING_RULE.code
      && primary.ruleVersion === PHASE3C_STEERING_RULE.version
      && primary.approvalStatus === "AUTO_APPROVED";

    let state = "INVALID";
    if (rows.length === 1 && exactCurrentMembership(rows[0])) state = "CURRENT";
    if (rows.length === 1 && exactTargetMembership(rows[0])) state = "ALREADY_UPGRADED";
    if (state === "CURRENT") report.wouldUpdate += 1;
    if (state === "ALREADY_UPGRADED") report.alreadyUpgraded += 1;

    if (rows.length !== 1) report.errors.push(`MEMBERSHIP_COUNT:${product.article}:${rows.length}`);
    if (state === "INVALID") report.errors.push(`MEMBERSHIP_STATE:${product.article}`);
    if (!hasEpc) report.errors.push(`EPC_CONTEXT:${product.article}`);
    if (!detectorMatches) report.errors.push(`DETECTOR_MISMATCH:${product.article}`);
    if (!resolverMatches) report.errors.push(`RESOLVER_MISMATCH:${product.article}`);

    report.targets.push({
      productId: product.id,
      article: product.article,
      state,
      detectedTypeCodes,
      technicalEpcGroups: product.technicalEpcGroups,
      resolverTarget: primary?.category?.slug || null,
      membershipCount: rows.length,
    });
  }

  if (report.wouldUpdate > 0 && report.alreadyUpgraded > 0) {
    report.errors.push("PARTIAL_TARGET_STATE");
  }
  if (
    report.wouldUpdate !== report.targetCount
    && report.alreadyUpgraded !== report.targetCount
  ) report.errors.push("TARGET_SET_NOT_ATOMIC");

  validateRuleAndCategory(report, category, rule);
}

function uniqueErrors(errors) {
  return [...new Set(errors)];
}

export async function runPhase3CSteeringUpgrade({
  mode = "DRY_RUN",
  expectedCount = 2,
  confirmation = null,
  dbPool = pool,
  repository = CustomerTaxonomyPhase3CSteeringUpgradeRepository,
  detector = detectCustomerProductTypes,
  resolver = resolveCustomerTaxonomy,
} = {}) {
  if (!['DRY_RUN', 'APPLY', 'VERIFY'].includes(mode)) {
    throw new Error(`Unsupported PHASE 3C steering upgrade mode: ${mode}`);
  }
  if (mode === "APPLY" && confirmation !== PHASE3C_STEERING_CONFIRMATION) {
    throw new Error(`APPLY requires confirmation ${PHASE3C_STEERING_CONFIRMATION}`);
  }

  const client = typeof dbPool.connect === "function"
    ? await dbPool.connect()
    : dbPool;
  const release = client !== dbPool && typeof client.release === "function";
  let transactionOpen = false;
  const report = {
    mode,
    expectedCount,
    targetCount: 0,
    wouldUpdate: 0,
    alreadyUpgraded: 0,
    updated: 0,
    targets: [],
    verification: null,
    globalIntegrity: null,
    errors: [],
  };

  try {
    await client.query(mode === "APPLY"
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
      : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    if (mode === "APPLY") {
      await repository.lockTargetProducts(PHASE3C_STEERING_ARTICLES, client);
    }

    const products = await repository.listTargetProducts(
      PHASE3C_STEERING_ARTICLES,
      client,
    );
    const productIds = products.map((product) => product.id);
    const memberships = await repository.listMembershipsForProducts(
      productIds,
      client,
      { lock: mode === "APPLY" },
    );
    const category = await repository.getCategoryBySlug(
      PHASE3C_STEERING_RULE.targetCategory,
      client,
    );
    const rule = await repository.getRule({
      code: PHASE3C_STEERING_RULE.code,
      version: PHASE3C_STEERING_RULE.version,
    }, client);

    report.targetCount = products.length;
    if (expectedCount !== PHASE3C_STEERING_ARTICLES.length) {
      report.errors.push(
        `EXPECTED_COUNT_MUST_BE:${PHASE3C_STEERING_ARTICLES.length}:${expectedCount}`,
      );
    }
    if (report.targetCount !== expectedCount) {
      report.errors.push(`EXPECTED_COUNT_MISMATCH:${expectedCount}:${report.targetCount}`);
    }
    addProductPreconditions({
      report,
      products,
      memberships,
      category,
      rule,
      detector,
      resolver,
    });
    report.errors = uniqueErrors(report.errors);

    if (mode === "VERIFY") {
      report.verification = verifyTargetState(products, memberships);
      report.globalIntegrity = await repository.getGlobalIntegrity(client);
      if (report.verification.correctTarget !== expectedCount) {
        report.errors.push(
          `VERIFY_TARGET_COUNT:${report.verification.correctTarget}:${expectedCount}`,
        );
      }
      if (
        report.verification.wrongCategory
        || report.verification.wrongSource
        || report.verification.wrongConfidence
        || report.verification.wrongRule
        || report.verification.duplicatePrimary
        || report.verification.secondaryMemberships
      ) report.errors.push("VERIFY_TARGET_INTEGRITY");
      if (
        report.globalIntegrity.duplicatePrimary
        || report.globalIntegrity.orphanRule
        || report.globalIntegrity.inactiveTarget
      ) report.errors.push("VERIFY_GLOBAL_INTEGRITY");
      report.errors = uniqueErrors(report.errors);
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
      throw new CustomerTaxonomyPhase3CSteeringUpgradeError(
        "PHASE 3C steering upgrade preflight failed",
        report,
      );
    }

    if (report.wouldUpdate === expectedCount) {
      const currentCategory = await repository.getCategoryBySlug(
        PHASE3C_STEERING_RULE.currentCategory,
        client,
      );
      if (!currentCategory) {
        report.errors.push("MISSING_CURRENT_CATEGORY:steering");
        throw new CustomerTaxonomyPhase3CSteeringUpgradeError(
          "PHASE 3C steering upgrade current category is missing",
          report,
        );
      }
      for (const product of products) {
        const updated = await repository.upgradeMembershipInPlace({
          productId: product.id,
          currentCategoryId: currentCategory.id,
          targetCategoryId: category.id,
          ruleCode: PHASE3C_STEERING_RULE.code,
          ruleVersion: PHASE3C_STEERING_RULE.version,
        }, client);
        if (!updated) {
          report.errors.push(`UPDATE_COUNT:${product.article}:0`);
          throw new CustomerTaxonomyPhase3CSteeringUpgradeError(
            "PHASE 3C steering upgrade update failed",
            report,
          );
        }
        report.updated += 1;
      }
    }

    const updatedMemberships = await repository.listMembershipsForProducts(
      productIds,
      client,
      { lock: true },
    );
    report.verification = verifyTargetState(products, updatedMemberships);
    report.globalIntegrity = await repository.getGlobalIntegrity(client);
    if (
      report.verification.correctTarget !== expectedCount
      || report.verification.wrongCategory
      || report.verification.wrongSource
      || report.verification.wrongConfidence
      || report.verification.wrongRule
      || report.verification.duplicatePrimary
      || report.verification.secondaryMemberships
      || report.globalIntegrity.duplicatePrimary
      || report.globalIntegrity.orphanRule
      || report.globalIntegrity.inactiveTarget
    ) {
      report.errors.push("POST_UPDATE_VERIFICATION_FAILED");
      throw new CustomerTaxonomyPhase3CSteeringUpgradeError(
        "PHASE 3C steering upgrade verification failed",
        report,
      );
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

export const CustomerTaxonomyPhase3CSteeringUpgradeService = {
  run: runPhase3CSteeringUpgrade,
};
