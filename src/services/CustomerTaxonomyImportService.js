import { detectApprovedExactPartType } from "./CustomerProductTypeDetector.js";
import { CustomerTaxonomyRepository } from "../repositories/CustomerTaxonomyRepository.js";
import { CustomerTaxonomyAssignmentService } from "./CustomerTaxonomyAssignmentService.js";
import { buildCustomerTaxonomyBatch2Coverage } from "./CustomerTaxonomyBatchPreviewService.js";
import { reviewedPhase2ERowForProduct } from "./CustomerTaxonomyPhase2EPreviewService.js";
import { reviewedPhase2FRowForProduct } from "./CustomerTaxonomyPhase2FPreviewService.js";
import { reviewedPhase2G1RowForProduct } from "./CustomerTaxonomyPhase2G1PreviewService.js";
import { reviewedPhase2G2RowForProduct } from "./CustomerTaxonomyPhase2G2PreviewService.js";
import { reviewedPhase2G3RowForProduct } from "./CustomerTaxonomyPhase2G3PreviewService.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_ASSIGNMENT_SOURCE,
  CUSTOMER_TAXONOMY_DECISION,
  resolveCustomerTaxonomy,
} from "./CustomerTaxonomyResolver.js";

const REVIEWED_TECHNICAL_EPC_SAFE_ROOT = Object.freeze({
  "42": "brakes",
  "43": "brakes",
});

// Only EPC groups whose accepted Phase 2 review has one public root and
// explicit SAFE_TOPLEVEL evidence. Mixed groups (14, 24, 32, 35, 90, etc.)
// deliberately stay out of this table. The existing reviewed per-product
// REAL_REVIEW decisions still take precedence below.
export const APPROVED_UNAMBIGUOUS_EPC_ROOT = Object.freeze({
  "03": "engine", "05": "engine", "07": "fuel-system",
  "26": "transmission-drivetrain", "27": "transmission-drivetrain",
  "37": "transmission-drivetrain", "41": "transmission-drivetrain",
  "52": "body-glass", "61": "body-glass", "62": "body-glass",
  "63": "body-glass", "65": "body-glass", "67": "body-glass",
  "74": "body-glass", "75": "body-glass", "78": "body-glass",
  "79": "body-glass", "82": "electrical-electronics-lighting",
  "85": "body-glass", "86": "interior-safety",
  "91": "interior-safety", "92": "interior-safety",
});

function conflictingNameSections(typeCodes, rules, section) {
  const detected = new Set(typeCodes || []);
  if (!detected.size) return [];
  const conflicting = new Set();
  for (const rule of rules || []) {
    if (!rule.isActive || rule.matchType !== "TYPE_CODE"
      || !detected.has(rule.matchValue)) continue;
    const targetSection = rule.targetParentSlug || rule.targetCategorySlug;
    if (targetSection && targetSection !== section) conflicting.add(targetSection);
  }
  return [...conflicting].sort();
}

export class CustomerTaxonomyImportIntegrityError extends Error {
  constructor(productId, issues = []) {
    super(`Invalid existing customer taxonomy primary for product ${productId}: ${issues.join(",")}`);
    this.name = "CustomerTaxonomyImportIntegrityError";
    this.code = "CUSTOMER_TAXONOMY_IMPORT_INTEGRITY";
    this.productId = productId;
    this.issues = [...issues];
  }
}

function primaryProposal(proposals = []) {
  return proposals.find((proposal) => (
    proposal.isPrimary
    && proposal.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
  )) || null;
}

function reviewedRows(product) {
  return [
    { phase: "PHASE_2E", row: reviewedPhase2ERowForProduct(product) },
    { phase: "PHASE_2F", row: reviewedPhase2FRowForProduct(product) },
    { phase: "PHASE_2G1", row: reviewedPhase2G1RowForProduct(product) },
    { phase: "PHASE_2G2", row: reviewedPhase2G2RowForProduct(product) },
    { phase: "PHASE_2G3", row: reviewedPhase2G3RowForProduct(product) },
  ].filter((item) => item.row);
}

function ambiguousLeafReason(product, resolution) {
  const names = [product.name, ...(product.translations || []).map((item) => item?.name)]
    .filter(Boolean).join(" ").normalize("NFKC");
  const slugs = new Set((resolution.proposals || []).map((item) => item.category?.slug));
  if (slugs.has("brakes-sensors")
    && /(?:держател|тримач|holder)/iu.test(names)
    && /(?:датч|sensor)/iu.test(names)) return "SENSOR_HOLDER_NOT_SENSOR";
  if (slugs.has("steering-tie-rods")
    && /(?:пильник|пыльник|dust\s+boot)/iu.test(names)) return "TIE_ROD_BOOT_NOT_ROD";
  if (slugs.has("exhaust-mounts")
    && /(?:хомут|затискач|зажим|clamp)/iu.test(names)
    && !/(?:вихлоп|выпуск|випуск|exhaust|глуш)/iu.test(names)) {
    return "GENERIC_CLAMP_WITH_EPC_ONLY";
  }
  if (slugs.has("body-mouldings-trims")
    && /(?:накладк|облицюв|облицов|trim|moulding|molding)/iu.test(names)
    && /(?:бампер|bumper)/iu.test(names)) return "BUMPER_TRIM_CATEGORY_CONFLICT";
  return null;
}

function safeTopLevelDisposition({
  product,
  resolution,
  existingMemberships,
  reviewedPhase3FBrakeFallback = false,
  rules,
  assignmentOrigin,
}) {
  const audited = reviewedRows(product);
  const realReview = audited.filter(({ row }) => row.finalBucket === "REAL_REVIEW");
  const approvedType = detectApprovedExactPartType(product);
  const exactProposal = primaryProposal(resolution.proposals);
  const approvedLeaf = { EXHAUST_SENSOR: "exhaust-sensors", ADBLUE_SCR_COMPONENT: "exhaust-adblue-scr", EXHAUST_ADBLUE_INJECTOR: "exhaust-adblue-scr", ENGINE_SENSOR: "engine-sensors", SUSPENSION_SUBFRAME_MOUNT: "suspension-subframes" }[approvedType];
  // A newer explicit owner-approved rule can supersede historical review.
  // Arbitrary matching rules and generic EPC fallbacks cannot.
  const supersedesReview = approvedLeaf && exactProposal?.category.slug === approvedLeaf
    && exactProposal.confidence === "HIGH" && exactProposal.assignmentSource === "RULE";
  if (realReview.length && !supersedesReview) {
    return {
      section: null,
      requiresReview: true,
      reason: realReview.map(({ phase }) => `${phase}_REAL_REVIEW`).join(";"),
    };
  }
  const ambiguousLeaf = ambiguousLeafReason(product, resolution);
  if (ambiguousLeaf) {
    return { section: null, requiresReview: true, reason: ambiguousLeaf };
  }
  const isNewImport = assignmentOrigin === CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT;
  const technicalEpc = [...new Set((product.technicalEpcGroups || []).map(String))];
  if (isNewImport && resolution.numberFamily === "A" && technicalEpc.length === 0) {
    return { section: null, requiresReview: true, reason: "NO_TECHNICAL_EPC" };
  }
  const mappedEpcSections = technicalEpc.map((epc) => (
    APPROVED_UNAMBIGUOUS_EPC_ROOT[epc]
    || REVIEWED_TECHNICAL_EPC_SAFE_ROOT[epc]
  ));
  if (isNewImport && technicalEpc.length > 1 && (
    mappedEpcSections.some((section) => !section)
    || new Set(mappedEpcSections).size !== 1
  )) {
    return { section: null, requiresReview: true, reason: "MULTIPLE_OR_UNAPPROVED_TECHNICAL_EPC" };
  }
  const exact = primaryProposal(resolution.proposals);
  if (exact) {
    const section = exact.category.parentSlug || exact.category.slug;
    if (isNewImport && conflictingNameSections(resolution.typeCodes, rules, section).length) {
      return { section: null, requiresReview: true, reason: "EPC_NAME_SECTION_CONFLICT" };
    }

    return { section: null, requiresReview: false, reason: null };
  }

  const evaluation = {
    productId: product.id,
    article: product.article,
    name: product.name,
    numberFamily: resolution.numberFamily,
    technicalEpc: product.technicalEpcGroups,
    detectedTypeCodes: resolution.typeCodes,
    existingMemberships,
  };
  const additions = (resolution.proposals || []).map((proposal) => ({
    productId: product.id,
    parentSlug: proposal.category.parentSlug,
    approvalStatus: proposal.approvalStatus,
  }));
  const batch2 = buildCustomerTaxonomyBatch2Coverage({
    evaluations: [evaluation],
    additions,
  });
  const phase2g3Review = audited.some(({ phase, row }) => (
    phase === "PHASE_2G3" && row.finalBucket === "REAL_REVIEW"
  ));
  // Batch 2 can label a dedicated EPC as SAFE_TOPLEVEL with no part semantics.
  // That is useful for a reviewed historical batch, but is not enough to
  // auto-assign an unseen product arriving through an import.
  const safeSections = new Set(batch2.safeTopLevel
    .filter((item) => item.detectedTypeCodes.length > 0)
    .map((item) => item.section));
  const epc = new Set((product.technicalEpcGroups || []).map(String));
  if ((epc.has("42") || epc.has("43"))
    && resolution.typeCodes.some((typeCode) => typeCode.startsWith("BRAKE_"))) {
    safeSections.add("brakes");
  }
  // Phase 3F is a separately reviewed, count-guarded historical backfill.
  // Preserve its approved EPC-only candidates without enabling this fallback
  // for new imports or the general uncategorized backfill.
  if (reviewedPhase3FBrakeFallback && (epc.has("42") || epc.has("43"))) {
    safeSections.add("brakes");
  }
  // Rear lamps have no approved narrow leaf. Explicit wording plus lighting EPC
  // is sufficient for the existing root, whereas EPC alone is not.
  if (["54", "82", "90"].some((group) => epc.has(group))
    && resolution.typeCodes.includes("LIGHTING_REAR_LAMP")) {
    safeSections.add("electrical-electronics-lighting");
  }
  if (isNewImport && resolution.numberFamily === "A") {
    for (const group of epc) {
      const approvedSection = APPROVED_UNAMBIGUOUS_EPC_ROOT[group];
      if (approvedSection) safeSections.add(approvedSection);
    }
  }
  if (!phase2g3Review) {
    for (const { row } of audited) {
      if (row.finalBucket !== "SAFE_TOPLEVEL") continue;
      safeSections.add(row.targetSection || row.section);
    }
  }
  const reviewReasons = [
    ...(resolution.conflicts || []).map((conflict) => conflict.reason),
    ...(resolution.proposals || [])
      .filter((proposal) => proposal.approvalStatus === CUSTOMER_APPROVAL_STATUS.REVIEW)
      .map(() => "REVIEW_PROPOSAL"),
    ...batch2.realReview.map((item) => item.reason),
    ...audited
      .filter(({ row }) => row.finalBucket === "REAL_REVIEW")
      .map(({ phase }) => `${phase}_REAL_REVIEW`),
  ];
  if (safeSections.size > 1) reviewReasons.push("MULTIPLE_SAFE_TOPLEVEL_TARGETS");
  if (safeSections.size === 1) {
    const [section] = safeSections;
    if (isNewImport && conflictingNameSections(resolution.typeCodes, rules, section).length) {
      reviewReasons.push("EPC_NAME_SECTION_CONFLICT");
    }
  }
  if (reviewReasons.length || safeSections.size !== 1) {
    return {
      section: null,
      requiresReview: reviewReasons.length > 0 || (isNewImport && resolution.numberFamily === "A"),
      reason: reviewReasons.join(";") || (isNewImport && resolution.numberFamily === "A"
        ? (product.technicalEpcGroups?.length
          ? "NO_UNAMBIGUOUS_APPROVED_EPC_ROOT"
          : "NO_TECHNICAL_EPC")
        : null),
    };
  }
  return {
    section: [...safeSections][0],
    requiresReview: false,
    reason: "REVIEWED_SAFE_TOPLEVEL",
  };
}

function safeProposal(category, assignmentOrigin) {
  return {
    category: {
      id: category.id,
      slug: category.slug,
      parentSlug: null,
    },
    isPrimary: true,
    assignmentSource: CUSTOMER_ASSIGNMENT_SOURCE.EPC_FALLBACK,
    assignmentOrigin,
    ruleCode: null,
    ruleVersion: null,
    confidence: "MEDIUM",
    approvalStatus: CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED,
  };
}

const supportedEvaluationOrigins = new Set([
  CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT,
  CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL,
]);

function assertEvaluationOrigin(assignmentOrigin) {
  if (!supportedEvaluationOrigins.has(assignmentOrigin)) {
    throw new Error(
      `Unsupported customer taxonomy evaluation origin: ${assignmentOrigin}`,
    );
  }
}

async function evaluateProduct({
  product,
  existingMemberships,
  context,
}, {
  db,
  repository,
  resolver,
  assignmentOrigin,
  reviewedPhase3FBrakeFallback,
}) {
  assertEvaluationOrigin(assignmentOrigin);
  if (reviewedPhase3FBrakeFallback && assignmentOrigin !== CUSTOMER_ASSIGNMENT_ORIGIN.BACKFILL) {
    throw new Error("Reviewed Phase 3F brake fallback is only available to backfill");
  }
  const rules = context?.rules || await repository.listActiveRules(db);
  const resolution = resolver({
    product,
    rules,
    existingMemberships,
    assignmentOrigin,
  });
  const disposition = safeTopLevelDisposition({
    product,
    resolution,
    existingMemberships,
    reviewedPhase3FBrakeFallback,
    rules,
    assignmentOrigin,
  });
  const proposals = (disposition.requiresReview ? [] : resolution.proposals || []).filter((proposal) => (
    proposal.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
    && (assignmentOrigin !== CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT || !disposition.requiresReview)
  ));
  if (!primaryProposal(proposals) && disposition.section) {
    let category = context?.categoryBySlug?.get(disposition.section) || null;
    if (!category) {
      [category] = await repository.listCategoriesBySlugs([disposition.section], db);
      if (category && context?.categoryBySlug) {
        context.categoryBySlug.set(disposition.section, category);
      }
    }
    if (
      !category
      || category.status !== "ACTIVE"
      || category.isActive !== true
      || category.parentId !== null
    ) {
      throw new Error(`Invalid SAFE customer taxonomy category: ${disposition.section}`);
    }
    proposals.push(safeProposal(category, assignmentOrigin));
  }
  return {
    product,
    resolution,
    disposition,
    proposals,
    candidate: primaryProposal(proposals),
  };
}

function resultDetail({ product, resolution, assignment, disposition, candidate }) {
  const existing = resolution.existingPrimaryDecision?.existingPrimary || null;
  const appliedPrimary = assignment.applied.find((membership) => membership.isPrimary) || null;
  const preserved = assignment.preservedApprovedPrimary || null;
  let decision = assignment.decision;
  if (decision === CUSTOMER_TAXONOMY_DECISION.NO_ACTION) {
    if (disposition.requiresReview) decision = CUSTOMER_TAXONOMY_DECISION.REQUIRES_REVIEW;
    else if (resolution.numberFamily === "OTHER") {
      decision = CUSTOMER_TAXONOMY_DECISION.UNSUPPORTED;
    } else decision = CUSTOMER_TAXONOMY_DECISION.UNCLASSIFIED;
  }
  const finalMembership = appliedPrimary || preserved || existing;
  return {
    productId: product.id,
    article: product.article,
    decision,
    existingCategory: existing?.categorySlug || null,
    candidateCategory: candidate?.category?.slug || null,
    finalCategory: appliedPrimary
      ? candidate?.category?.slug || null
      : finalMembership?.categorySlug || null,
    assignmentSource: appliedPrimary?.assignmentSource
      || finalMembership?.assignmentSource
      || candidate?.assignmentSource
      || null,
    confidence: appliedPrimary?.confidence
      || finalMembership?.confidence
      || candidate?.confidence
      || null,
    ruleCode: appliedPrimary?.ruleCode
      || finalMembership?.ruleCode
      || candidate?.ruleCode
      || null,
    ruleVersion: appliedPrimary?.ruleVersion
      || finalMembership?.ruleVersion
      || candidate?.ruleVersion
      || null,
    preservedExisting: [
      CUSTOMER_TAXONOMY_DECISION.PRESERVE_MANUAL,
      CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
    ].includes(assignment.decision),
    reason: disposition.reason || assignment.decision,
  };
}

export const CustomerTaxonomyImportService = {
  async createContext({ db, repository = CustomerTaxonomyRepository } = {}) {
    if (!db) throw new Error("Customer taxonomy import transaction client is required");
    return {
      rules: await repository.listActiveRules(db),
      categoryBySlug: new Map(),
    };
  },

  async evaluateProduct({ product, existingMemberships = [], context }, {
    db,
    repository = CustomerTaxonomyRepository,
    resolver = resolveCustomerTaxonomy,
    assignmentOrigin = CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT,
    reviewedPhase3FBrakeFallback = false,
  } = {}) {
    if (!db) throw new Error("Customer taxonomy import transaction client is required");
    if (!product) throw new Error("Product is required for customer taxonomy evaluation");
    return evaluateProduct({
      product,
      existingMemberships,
      context,
    }, {
      db,
      repository,
      resolver,
      assignmentOrigin,
      reviewedPhase3FBrakeFallback,
    });
  },

  async classifyProduct({ productId, context }, {
    db,
    repository = CustomerTaxonomyRepository,
    resolver = resolveCustomerTaxonomy,
    assignmentService = CustomerTaxonomyAssignmentService,
    assignmentOrigin = CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT,
    reviewedPhase3FBrakeFallback = false,
  } = {}) {
    if (!db) throw new Error("Customer taxonomy import transaction client is required");
    const normalizedProductId = Number(productId);
    if (!Number.isInteger(normalizedProductId) || normalizedProductId <= 0) {
      throw new Error("Invalid product id for customer taxonomy import");
    }
    await repository.lockProductForAssignment(normalizedProductId, db);
    const product = await repository.findProductForResolution(normalizedProductId, db);
    if (!product) throw new Error("Product not found for customer taxonomy import");
    const existingMemberships = await repository.listMembershipsForProduct(
      normalizedProductId,
      db,
      { lock: true },
    );
    const evaluation = await evaluateProduct({
      product,
      existingMemberships,
      context,
    }, {
      db,
      repository,
      resolver,
      assignmentOrigin,
      reviewedPhase3FBrakeFallback,
    });
    const {
      resolution,
      disposition,
      proposals,
      candidate,
    } = evaluation;
    const assignment = await assignmentService.applyResolutionInTransaction({
      productId: normalizedProductId,
      resolution: { ...resolution, proposals },
      assignmentOrigin,
    }, { db, repository });
    if (assignment.decision === CUSTOMER_TAXONOMY_DECISION.INVALID_EXISTING_PRIMARY) {
      throw new CustomerTaxonomyImportIntegrityError(
        normalizedProductId,
        assignment.decisionIssues,
      );
    }
    const detail = resultDetail({
      product,
      resolution,
      assignment,
      disposition,
      candidate,
    });
    if (assignmentOrigin === CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT) {
      await repository.recordImportDecision({
        productId: normalizedProductId,
        decision: detail.decision,
        reason: detail.reason,
      }, db);
    }
    return detail;
  },
};
