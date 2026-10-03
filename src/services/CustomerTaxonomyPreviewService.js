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

function describeProposal(product, proposal) {
  return {
    productId: product.id,
    article: product.article,
    technicalEpc: product.technicalEpcGroups,
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
  };
}

export async function runCustomerTaxonomyPreview({
  dbPool = pool,
  repository = CustomerTaxonomyRepository,
  resolver = resolveCustomerTaxonomy,
} = {}) {
  const client = typeof dbPool.connect === "function"
    ? await dbPool.connect()
    : dbPool;
  const release = client !== dbPool && typeof client.release === "function";
  let transactionOpen = false;
  try {
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;
    const products = await repository.listProductsForPreview(client);
    const rules = await repository.listActiveRules(client);
    const memberships = await repository.listMemberships(client);

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
    const review = [];
    const proposedKeys = new Set();

    for (const product of products) {
      const existingMemberships = membershipsByProduct.get(product.id) || [];
      const resolution = resolver({
        product,
        rules,
        existingMemberships,
        assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.SYSTEM,
      });

      if (resolution.unclassified) {
        unclassified.push({
          productId: product.id,
          article: product.article,
          technicalEpc: product.technicalEpcGroups,
          diagnostics: resolution.diagnostics,
        });
      }
      if (resolution.conflicts.length) {
        conflicts.push({
          productId: product.id,
          article: product.article,
          conflicts: resolution.conflicts,
        });
      }

      for (const proposal of resolution.proposals) {
        const key = membershipKey(product.id, proposal.category.id);
        proposedKeys.add(key);
        const existing = membershipByKey.get(key);
        const described = describeProposal(product, proposal);
        if (!existing) additions.push(described);
        if (proposal.approvalStatus === CUSTOMER_APPROVAL_STATUS.REVIEW) {
          review.push(described);
        }
        if (
          existing?.ruleCode
          && (
            existing.ruleCode !== proposal.ruleCode
            || existing.ruleVersion !== proposal.ruleVersion
          )
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

      const activeRule = membership.ruleCode
        ? activeRuleByCode.get(membership.ruleCode)
        : null;
      if (
        activeRule
        && membership.ruleVersion !== activeRule.version
        && !changedRules.some((item) => (
          item.productId === membership.productId
          && item.categoryId === membership.customerCategoryId
        ))
      ) {
        changedRules.push({
          productId: membership.productId,
          categoryId: membership.customerCategoryId,
          previous: {
            code: membership.ruleCode,
            version: membership.ruleVersion,
          },
          proposed: {
            code: activeRule.code,
            version: activeRule.version,
          },
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

    await client.query("ROLLBACK");
    transactionOpen = false;
    return {
      mode: "DRY_RUN",
      summary: {
        products: products.length,
        additions: additions.length,
        removals: removals.length,
        changedRules: changedRules.length,
        conflicts: conflicts.length,
        unclassified: unclassified.length,
        review: review.length,
      },
      additions,
      removals,
      changedRules,
      conflicts,
      unclassified,
      review,
      integrity: { missingPrimary, multiplePrimary },
    };
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
