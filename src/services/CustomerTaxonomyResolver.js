import {
  CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
  detectCustomerProductTypes,
  isKnownCustomerProductTypeCode,
  reviewedPhase2G3DispositionForProduct,
} from "./CustomerProductTypeDetector.js";

export const CUSTOMER_ASSIGNMENT_SOURCE = Object.freeze({
  MANUAL: "MANUAL",
  RULE: "RULE",
  EPC_FALLBACK: "EPC_FALLBACK",
});

export const CUSTOMER_ASSIGNMENT_ORIGIN = Object.freeze({
  ADMIN: "ADMIN",
  IMPORT: "IMPORT",
  BACKFILL: "BACKFILL",
  MIGRATION: "MIGRATION",
  SYSTEM: "SYSTEM",
});

export const CUSTOMER_APPROVAL_STATUS = Object.freeze({
  AUTO_APPROVED: "AUTO_APPROVED",
  MANUAL_APPROVED: "MANUAL_APPROVED",
  REVIEW: "REVIEW",
  REJECTED: "REJECTED",
});

const sourceRank = Object.freeze({ RULE: 2, EPC_FALLBACK: 1 });
const confidenceRank = Object.freeze({ HIGH: 3, MEDIUM: 2, LOW: 1 });
const specificityRank = Object.freeze({
  ARTICLE_EXACT: 5,
  ARTICLE_PREFIX: 4,
  EPC_TYPE_CODE: 3,
  TYPE_CODE: 2,
  EPC_ONLY: 1,
});

export function normalizeCustomerArticle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function customerNumberFamily(product = {}) {
  const article = normalizeCustomerArticle(
    product.articleNormalized ?? product.article_normalized ?? product.article,
  );
  if (article.startsWith("A")) return "A";
  if (article.startsWith("N")) return "N";
  if (article.startsWith("B")) return "B";
  return "OTHER";
}

function value(rule, camel, snake = camel) {
  return rule?.[camel] ?? rule?.[snake];
}

function normalizeEpc(valueToNormalize) {
  return String(valueToNormalize || "").trim().toUpperCase();
}

function ruleSpecificity(rule) {
  const matchType = value(rule, "matchType", "match_type");
  if (matchType === "TYPE_CODE" && value(rule, "epcGroup", "epc_group")) {
    return specificityRank.EPC_TYPE_CODE;
  }
  return specificityRank[matchType] || 0;
}

function ruleTargetId(rule) {
  return Number(value(rule, "targetCategoryId", "target_category_id"));
}

function ruleTarget(rule) {
  return {
    id: ruleTargetId(rule),
    slug: value(rule, "targetCategorySlug", "target_category_slug") || null,
    parentId: value(rule, "targetParentId", "target_parent_id") === null
      || value(rule, "targetParentId", "target_parent_id") === undefined
      ? null
      : Number(value(rule, "targetParentId", "target_parent_id")),
    parentSlug: value(rule, "targetParentSlug", "target_parent_slug") || null,
  };
}

function activeTarget(rule) {
  const ruleActive = value(rule, "isActive", "is_active");
  const categoryActive = value(rule, "targetIsActive", "target_is_active");
  const categoryStatus = value(rule, "targetStatus", "target_status");
  return ruleActive !== false
    && categoryActive !== false
    && (!categoryStatus || categoryStatus === "ACTIVE");
}

function excluded(rule, context) {
  const values = value(rule, "excludeValues", "exclude_values") || [];
  return values.some((excludedValue) => {
    const normalized = String(excludedValue || "").trim().toUpperCase();
    if (!normalized) return false;
    const normalizedArticle = normalizeCustomerArticle(normalized);
    return context.typeCodes.has(normalized)
      || context.epcGroups.has(normalizeEpc(normalized))
      || context.article === normalizedArticle
      || (normalizedArticle && context.article.startsWith(normalizedArticle));
  });
}

function ruleMatches(rule, context) {
  if (!activeTarget(rule) || !ruleTargetId(rule)) return false;

  const detectorVersion = Number(
    value(rule, "detectorVersion", "detector_version") || 0,
  );
  if (detectorVersion !== CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION) return false;

  const family = value(rule, "numberFamily", "number_family");
  if (family && family !== context.numberFamily) return false;

  const epcGroup = value(rule, "epcGroup", "epc_group");
  if (epcGroup && !context.epcGroups.has(normalizeEpc(epcGroup))) return false;
  if (excluded(rule, context)) return false;

  const matchType = value(rule, "matchType", "match_type");
  const matchValue = value(rule, "matchValue", "match_value");
  if (matchType === "ARTICLE_EXACT") {
    return context.article === normalizeCustomerArticle(matchValue);
  }
  if (matchType === "ARTICLE_PREFIX") {
    return context.article.startsWith(normalizeCustomerArticle(matchValue));
  }
  if (matchType === "TYPE_CODE") {
    const typeCode = String(matchValue || "").trim().toUpperCase();
    return isKnownCustomerProductTypeCode(typeCode)
      && context.typeCodes.has(typeCode);
  }
  return matchType === "EPC_ONLY" && Boolean(epcGroup);
}

function compareRules(left, right) {
  const leftSource = sourceRank[value(left, "sourceKind", "source_kind")] || 0;
  const rightSource = sourceRank[value(right, "sourceKind", "source_kind")] || 0;
  if (leftSource !== rightSource) return rightSource - leftSource;

  const leftSpecificity = ruleSpecificity(left);
  const rightSpecificity = ruleSpecificity(right);
  if (leftSpecificity !== rightSpecificity) return rightSpecificity - leftSpecificity;

  const leftPriority = Number(value(left, "priority") || 0);
  const rightPriority = Number(value(right, "priority") || 0);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const leftConfidence = confidenceRank[value(left, "confidence")] || 0;
  const rightConfidence = confidenceRank[value(right, "confidence")] || 0;
  if (leftConfidence !== rightConfidence) return rightConfidence - leftConfidence;

  const leftVersion = Number(value(left, "version") || 0);
  const rightVersion = Number(value(right, "version") || 0);
  if (leftVersion !== rightVersion) return rightVersion - leftVersion;
  return Number(value(left, "id") || 0) - Number(value(right, "id") || 0);
}

function sameStrength(left, right) {
  return (sourceRank[value(left, "sourceKind", "source_kind")] || 0)
      === (sourceRank[value(right, "sourceKind", "source_kind")] || 0)
    && ruleSpecificity(left) === ruleSpecificity(right)
    && Number(value(left, "priority") || 0) === Number(value(right, "priority") || 0)
    && (confidenceRank[value(left, "confidence")] || 0)
      === (confidenceRank[value(right, "confidence")] || 0);
}

function proposalFromRule(rule, assignmentOrigin, { conflict = false } = {}) {
  const confidence = value(rule, "confidence");
  const source = value(rule, "sourceKind", "source_kind");
  const role = value(rule, "assignmentRole", "assignment_role") || "PRIMARY";
  const autoApproved = !conflict
    && [
      CUSTOMER_ASSIGNMENT_SOURCE.RULE,
      CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK,
    ].includes(source)
    && confidence === "HIGH"
    && Boolean(value(rule, "autoApprovalAllowed", "auto_approval_allowed"));
  return {
    category: ruleTarget(rule),
    assignmentSource: source,
    assignmentOrigin,
    ruleCode: value(rule, "code"),
    ruleVersion: Number(value(rule, "version")),
    confidence,
    approvalStatus: autoApproved
      ? CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
      : CUSTOMER_APPROVAL_STATUS.REVIEW,
    isPrimary: role === "PRIMARY" && autoApproved,
    assignmentRole: role,
    conflict,
    specificity: ruleSpecificity(rule),
  };
}

function manualPrimary(memberships = []) {
  return memberships.find((membership) => (
    value(membership, "assignmentSource", "assignment_source")
      === CUSTOMER_ASSIGNMENT_SOURCE.MANUAL
    && value(membership, "approvalStatus", "approval_status")
      === CUSTOMER_APPROVAL_STATUS.MANUAL_APPROVED
    && Boolean(value(membership, "isPrimary", "is_primary"))
  )) || null;
}

function phase2G3PreservedFunctionalCategoryIds(disposition, memberships = []) {
  if (!["SAFE_TOPLEVEL", "REAL_REVIEW"].includes(disposition?.finalBucket)) {
    return null;
  }
  return new Set(memberships.filter((membership) => (
    value(membership, "assignmentSource", "assignment_source")
      === CUSTOMER_ASSIGNMENT_SOURCE.RULE
    && value(membership, "approvalStatus", "approval_status")
      === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
    && Boolean(value(membership, "isPrimary", "is_primary"))
  )).map((membership) => Number(
    value(membership, "customerCategoryId", "customer_category_id"),
  )).filter(Number.isInteger));
}

export function resolveCustomerTaxonomy({
  product,
  rules = [],
  existingMemberships = [],
  assignmentOrigin = CUSTOMER_ASSIGNMENT_ORIGIN.SYSTEM,
} = {}) {
  const detectedTypeCodes = detectCustomerProductTypes(product);
  const phase2g3Disposition = reviewedPhase2G3DispositionForProduct(product);
  const preservedFunctionalCategoryIds = phase2G3PreservedFunctionalCategoryIds(
    phase2g3Disposition,
    existingMemberships,
  );
  const context = {
    article: normalizeCustomerArticle(
      product?.articleNormalized ?? product?.article_normalized ?? product?.article,
    ),
    numberFamily: customerNumberFamily(product),
    epcGroups: new Set(
      (product?.technicalEpcGroups || product?.technical_epc_groups || [])
        .map(normalizeEpc)
        .filter(Boolean),
    ),
    typeCodes: new Set(detectedTypeCodes),
  };

  const diagnostics = [];
  const matching = [];
  for (const rule of rules) {
    const matchType = value(rule, "matchType", "match_type");
    const matchValue = value(rule, "matchValue", "match_value");
    if (matchType === "TYPE_CODE" && !isKnownCustomerProductTypeCode(matchValue)) {
      diagnostics.push({
        ruleCode: value(rule, "code"),
        reason: "UNKNOWN_TYPE_CODE",
        value: matchValue,
      });
      continue;
    }
    const detectorVersion = Number(
      value(rule, "detectorVersion", "detector_version") || 0,
    );
    if (detectorVersion !== CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION) {
      diagnostics.push({
        ruleCode: value(rule, "code"),
        reason: "UNSUPPORTED_DETECTOR_VERSION",
        value: detectorVersion,
      });
      continue;
    }
    if (!ruleMatches(rule, context)) continue;
    if (preservedFunctionalCategoryIds) {
      const target = ruleTarget(rule);
      const targetSection = target.parentSlug || target.slug;
      if (
        target.parentSlug === "fasteners-seals-standard-parts"
        || targetSection !== phase2g3Disposition.targetSection
        || !preservedFunctionalCategoryIds.has(target.id)
      ) continue;
    }
    matching.push(rule);
  }

  matching.sort(compareRules);
  const preservedManualPrimary = manualPrimary(existingMemberships);
  const primaryRules = matching.filter((rule) => (
    (value(rule, "assignmentRole", "assignment_role") || "PRIMARY") === "PRIMARY"
  ));
  const secondaryRules = matching.filter((rule) => (
    value(rule, "assignmentRole", "assignment_role") === "SECONDARY"
  ));

  const proposals = [];
  const conflicts = [];
  if (!preservedManualPrimary && primaryRules.length) {
    const strongest = primaryRules[0];
    const equallyStrong = primaryRules.filter((rule) => sameStrength(rule, strongest));
    const targetIds = new Set(equallyStrong.map(ruleTargetId));
    if (targetIds.size > 1) {
      const conflictProposals = equallyStrong.map((rule) => (
        proposalFromRule(rule, assignmentOrigin, { conflict: true })
      ));
      proposals.push(...conflictProposals);
      conflicts.push({
        reason: "EQUAL_PRIMARY_STRENGTH",
        candidates: conflictProposals,
      });
    } else {
      proposals.push(proposalFromRule(strongest, assignmentOrigin));
    }
  }

  const secondaryTargets = new Set();
  for (const rule of secondaryRules) {
    const targetId = ruleTargetId(rule);
    if (secondaryTargets.has(targetId)) continue;
    secondaryTargets.add(targetId);
    proposals.push(proposalFromRule(rule, assignmentOrigin));
  }

  return {
    detectorVersion: CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
    article: context.article,
    numberFamily: context.numberFamily,
    technicalEpcGroups: [...context.epcGroups],
    typeCodes: detectedTypeCodes,
    manualPrimaryPreserved: Boolean(preservedManualPrimary),
    manualPrimary: preservedManualPrimary,
    proposals,
    conflicts,
    diagnostics,
    unclassified: !preservedManualPrimary && proposals.length === 0,
  };
}
