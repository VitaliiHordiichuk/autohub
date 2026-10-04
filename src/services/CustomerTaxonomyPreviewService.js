import { pool } from "../config/db.js";
import { CustomerTaxonomyRepository } from "../repositories/CustomerTaxonomyRepository.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  CUSTOMER_ASSIGNMENT_SOURCE,
  resolveCustomerTaxonomy,
} from "./CustomerTaxonomyResolver.js";

function membershipKey(productId, categoryId) {
  return `${productId}:${categoryId}`;
}

function describeProposal(product, proposal, resolution, matchedRule) {
  const matchDescription = matchedRule
    ? [
      matchedRule.numberFamily ? `family=${matchedRule.numberFamily}` : null,
      matchedRule.epcGroup ? `epc=${matchedRule.epcGroup}` : null,
      `${matchedRule.matchType}=${matchedRule.matchValue}`,
    ].filter(Boolean).join(", ")
    : null;
  return {
    productId: product.id,
    article: product.article,
    name: product.name,
    technicalEpc: product.technicalEpcGroups,
    detectedTypeCodes: resolution.typeCodes || [],
    categoryId: proposal.category.id,
    categorySlug: proposal.category.slug,
    parentSlug: proposal.category.parentSlug,
    assignmentSource: proposal.assignmentSource,
    assignmentOrigin: proposal.assignmentOrigin,
    ruleCode: proposal.ruleCode,
    ruleVersion: proposal.ruleVersion,
    confidence: proposal.confidence,
    approvalStatus: proposal.approvalStatus,
    isPrimary: proposal.isPrimary,
    reason: matchDescription ? `Matched reviewed rule: ${matchDescription}` : null,
  };
}

export async function buildCustomerTaxonomyPreview({
  db,
  repository = CustomerTaxonomyRepository,
  resolver = resolveCustomerTaxonomy,
  assignmentOrigin = CUSTOMER_ASSIGNMENT_ORIGIN.SYSTEM,
  includeEvaluations = false,
} = {}) {
  const products = await repository.listProductsForPreview(db);
  const rules = await repository.listActiveRules(db);
  const memberships = await repository.listMemberships(db);

  const membershipsByProduct = new Map();
  const membershipByKey = new Map();
  for (const membership of memberships) {
    const list = membershipsByProduct.get(membership.productId) || [];
    list.push(membership);
    membershipsByProduct.set(membership.productId, list);
    membershipByKey.set(
      membershipKey(membership.productId, membership.customerCategoryId),
      membership,
    );
  }

  const activeRuleByCode = new Map(rules.map((rule) => [rule.code, rule]));
  const additions = [];
  const removals = [];
  const changedRules = [];
  const conflicts = [];
  const unclassified = [];
  const autoApproved = [];
  const review = [];
  const manualPreserved = [];
  const proposedKeys = new Set();
  const drift = {
    sameCategory: [],
    differentCategory: [],
    noLongerMatches: [],
  };
  const driftMembershipKeys = new Set();
  const evaluations = [];

  for (const product of products) {
    const existingMemberships = membershipsByProduct.get(product.id) || [];
    const resolution = resolver({
      product,
      rules,
      existingMemberships,
      assignmentOrigin,
    });

    if (includeEvaluations) {
      evaluations.push({
        productId: product.id,
        article: product.article,
        name: product.name,
        numberFamily: resolution.numberFamily,
        technicalEpc: product.technicalEpcGroups,
        detectedTypeCodes: resolution.typeCodes || [],
        existingMemberships: existingMemberships.map((membership) => ({
          categoryId: membership.customerCategoryId,
          categorySlug: membership.categorySlug,
          parentSlug: membership.parentSlug,
          approvalStatus: membership.approvalStatus,
          isPrimary: membership.isPrimary,
        })),
        proposals: resolution.proposals.map((proposal) => ({
          categoryId: proposal.category.id,
          categorySlug: proposal.category.slug,
          parentSlug: proposal.category.parentSlug,
          confidence: proposal.confidence,
          approvalStatus: proposal.approvalStatus,
          isPrimary: proposal.isPrimary,
        })),
      });
    }

    if (resolution.manualPrimaryPreserved) {
      manualPreserved.push({
        productId: product.id,
        article: product.article,
        name: product.name,
        categoryId: resolution.manualPrimary?.customerCategoryId
          ?? resolution.manualPrimary?.customer_category_id
          ?? null,
      });
    }

    if (resolution.unclassified) {
      unclassified.push({
        productId: product.id,
        article: product.article,
        name: product.name,
        technicalEpc: product.technicalEpcGroups,
        detectedTypeCodes: resolution.typeCodes || [],
        diagnostics: resolution.diagnostics,
      });
    }
    if (resolution.conflicts.length) {
      conflicts.push({
        productId: product.id,
        article: product.article,
        name: product.name,
        conflicts: resolution.conflicts,
      });
    }

    const existingRulePrimary = existingMemberships.find((membership) => (
      membership.isPrimary
      && membership.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.RULE
      && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
    ));
    if (existingRulePrimary) {
      const driftKey = membershipKey(
        existingRulePrimary.productId,
        existingRulePrimary.customerCategoryId,
      );
      driftMembershipKeys.add(driftKey);
      const proposedPrimary = resolution.proposals.find((proposal) => proposal.isPrimary);
      const detail = {
        productId: product.id,
        article: product.article,
        name: product.name,
        existing: {
          categoryId: existingRulePrimary.customerCategoryId,
          categorySlug: existingRulePrimary.categorySlug,
          ruleCode: existingRulePrimary.ruleCode,
          ruleVersion: existingRulePrimary.ruleVersion,
        },
        proposed: proposedPrimary ? {
          categoryId: proposedPrimary.category.id,
          categorySlug: proposedPrimary.category.slug,
          ruleCode: proposedPrimary.ruleCode,
          ruleVersion: proposedPrimary.ruleVersion,
        } : null,
      };
      if (!proposedPrimary) drift.noLongerMatches.push(detail);
      else if (proposedPrimary.category.id === existingRulePrimary.customerCategoryId) {
        drift.sameCategory.push(detail);
      } else drift.differentCategory.push(detail);
    }

    for (const proposal of resolution.proposals) {
      const key = membershipKey(product.id, proposal.category.id);
      proposedKeys.add(key);
      const existing = membershipByKey.get(key);
      const described = describeProposal(
        product,
        proposal,
        resolution,
        activeRuleByCode.get(proposal.ruleCode),
      );
      if (!existing) additions.push(described);
      if (proposal.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED) {
        autoApproved.push(described);
      }
      if (proposal.approvalStatus === CUSTOMER_APPROVAL_STATUS.REVIEW) {
        review.push(described);
      }
      if (
        existing?.ruleCode
        && existing.ruleCode !== proposal.ruleCode
      ) {
        changedRules.push({
          productId: product.id,
          article: product.article,
          categoryId: proposal.category.id,
          previous: {
            code: existing.ruleCode,
            version: existing.ruleVersion,
          },
          proposed: {
            code: proposal.ruleCode,
            version: proposal.ruleVersion,
          },
        });
      }
    }
  }

  for (const membership of memberships) {
    if (membership.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.MANUAL) continue;
    const key = membershipKey(
      membership.productId,
      membership.customerCategoryId,
    );
    if (!proposedKeys.has(key)) removals.push(membership);

    if (
      membership.isPrimary
      && membership.assignmentSource === CUSTOMER_ASSIGNMENT_SOURCE.RULE
      && membership.approvalStatus === CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED
      && !driftMembershipKeys.has(key)
    ) {
      drift.noLongerMatches.push({
        productId: membership.productId,
        article: null,
        name: null,
        existing: {
          categoryId: membership.customerCategoryId,
          categorySlug: membership.categorySlug,
          ruleCode: membership.ruleCode,
          ruleVersion: membership.ruleVersion,
        },
        proposed: null,
      });
    }
  }

  const missingPrimary = [];
  const multiplePrimary = [];
  for (const [productId, productMemberships] of membershipsByProduct) {
    const approved = productMemberships.filter((membership) => (
      [
        CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED,
        CUSTOMER_APPROVAL_STATUS.MANUAL_APPROVED,
      ].includes(membership.approvalStatus)
    ));
    const primary = approved.filter((membership) => membership.isPrimary);
    if (approved.length && primary.length === 0) missingPrimary.push(productId);
    if (primary.length > 1) multiplePrimary.push(productId);
  }

  const report = {
    mode: "DRY_RUN",
    summary: {
      products: products.length,
      existingMemberships: memberships.length,
      additions: additions.length,
      removals: removals.length,
      changedRules: changedRules.length,
      conflicts: conflicts.length,
      unclassified: unclassified.length,
      autoApproved: autoApproved.length,
      review: review.length,
      manualPreserved: manualPreserved.length,
      classificationDrift: {
        sameCategory: drift.sameCategory.length,
        differentCategory: drift.differentCategory.length,
        noLongerMatches: drift.noLongerMatches.length,
      },
    },
    additions,
    removals,
    changedRules,
    conflicts,
    unclassified,
    autoApproved,
    review,
    manualPreserved,
    classificationDrift: drift,
    integrity: { missingPrimary, multiplePrimary },
  };
  if (includeEvaluations) report.evaluations = evaluations;
  return report;
}

export async function runCustomerTaxonomyPreview({
  dbPool = pool,
  repository = CustomerTaxonomyRepository,
  resolver = resolveCustomerTaxonomy,
  includeEvaluations = false,
} = {}) {
  const client = typeof dbPool.connect === "function"
    ? await dbPool.connect()
    : dbPool;
  const release = client !== dbPool && typeof client.release === "function";
  let transactionOpen = false;
  try {
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;
    const report = await buildCustomerTaxonomyPreview({
      db: client,
      repository,
      resolver,
      includeEvaluations,
    });

    await client.query("ROLLBACK");
    transactionOpen = false;
    return report;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (release) client.release();
  }
}

export const CustomerTaxonomyPreviewService = {
  run: runCustomerTaxonomyPreview,
};
