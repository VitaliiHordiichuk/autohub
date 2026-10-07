import assert from "node:assert/strict";
import test from "node:test";

import { CustomerTaxonomyAssignmentService } from "./CustomerTaxonomyAssignmentService.js";
import {
  CustomerTaxonomyPhase3FBrakesBackfillError,
  PHASE3F_BRAKES_CONFIRMATION,
  parsePhase3FBrakesBackfillArguments,
  runPhase3FBrakesBackfill,
} from "./CustomerTaxonomyPhase3FBrakesBackfillService.js";
import { CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION } from "./CustomerProductTypeDetector.js";

const categories = [
  { id: 10, slug: "brakes", parentId: null, status: "ACTIVE", isActive: true },
  { id: 11, slug: "brakes-discs", parentId: 10, status: "ACTIVE", isActive: true },
  { id: 20, slug: "engine", parentId: null, status: "ACTIVE", isActive: true },
];

const products = [
  product(1, "A1674216003", "Диск гальмівний", "42"),
  product(2, "A9984200002", "Деталь", "42"),
  product(3, "A9984300003", "Деталь", "43"),
  product(4, "A0004210887", "Ущільнювач", "42"),
  product(5, "A9984200005", "Деталь", "42"),
  product(6, "A9984300006", "Деталь", "43"),
  product(7, "A9989900007", "Деталь", "99"),
];

function product(id, article, name, epc) {
  return {
    id,
    article,
    articleNormalized: article,
    name,
    brandId: 1,
    brandName: "Mercedes-Benz",
    technicalEpcGroups: [epc],
    technicalCategories: [],
  };
}

function brakeDiscRule() {
  return {
    id: 1,
    code: "BRAKE_DISC_A_EPC42_V1",
    version: 2,
    detectorVersion: CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
    sourceKind: "RULE",
    assignmentRole: "PRIMARY",
    numberFamily: "A",
    epcGroup: "42",
    matchType: "TYPE_CODE",
    matchValue: "BRAKE_DISC",
    excludeValues: [],
    targetCategoryId: 11,
    targetCategorySlug: "brakes-discs",
    targetParentId: 10,
    targetParentSlug: "brakes",
    targetStatus: "ACTIVE",
    targetIsActive: true,
    priority: 100,
    confidence: "HIGH",
    autoApprovalAllowed: true,
    isActive: true,
  };
}

function membership({
  productId,
  categoryId,
  source,
  origin,
  confidence,
  approvalStatus,
  ruleCode = null,
  ruleVersion = null,
}) {
  const category = categories.find((item) => item.id === categoryId);
  return {
    productId,
    customerCategoryId: categoryId,
    categorySlug: category.slug,
    parentSlug: category.parentId
      ? categories.find((item) => item.id === category.parentId)?.slug || null
      : null,
    isPrimary: true,
    assignmentSource: source,
    assignmentOrigin: origin,
    ruleCode,
    ruleVersion,
    confidence,
    approvalStatus,
    categoryStatus: category.status,
    categoryIsActive: category.isActive,
    historicalRuleExists: ruleCode ? true : null,
    historicalRuleIsActive: ruleCode ? true : null,
    historicalRuleTargetCategoryId: ruleCode ? categoryId : null,
  };
}

function fixture() {
  const initialMemberships = [
    membership({
      productId: 5,
      categoryId: 20,
      source: "MANUAL",
      origin: "ADMIN",
      confidence: "HIGH",
      approvalStatus: "MANUAL_APPROVED",
    }),
    membership({
      productId: 6,
      categoryId: 20,
      source: "EPC_FALLBACK",
      origin: "BACKFILL",
      confidence: "MEDIUM",
      approvalStatus: "AUTO_APPROVED",
    }),
  ];
  const state = {
    memberships: structuredClone(initialMemberships),
  };
  let transactionSnapshot = null;
  const commands = [];
  const dbPool = {
    async query(sql) {
      const command = String(sql).trim();
      commands.push(command);
      if (command.startsWith("BEGIN")) {
        transactionSnapshot = structuredClone(state.memberships);
      }
      if (command === "ROLLBACK" && transactionSnapshot) {
        state.memberships = structuredClone(transactionSnapshot);
        transactionSnapshot = null;
      }
      if (command === "COMMIT") transactionSnapshot = null;
      return { rows: [], rowCount: 0 };
    },
  };
  const rules = [brakeDiscRule()];
  const repository = {
    async listProductsForPreview() {
      return products.map((item) => structuredClone(item));
    },
    async findProductForResolution(productId) {
      const found = products.find((item) => item.id === Number(productId));
      return found ? structuredClone(found) : null;
    },
    async listActiveRules() {
      return rules.map((item) => ({ ...item }));
    },
    async listCategoriesBySlugs(slugs) {
      return categories.filter((item) => slugs.includes(item.slug)).map((item) => ({ ...item }));
    },
    async listMemberships() {
      return structuredClone(state.memberships);
    },
    async listMembershipsForProduct(productId) {
      return structuredClone(state.memberships.filter((item) => (
        item.productId === Number(productId)
      )));
    },
    async lockProductForAssignment(productId) {
      assert.ok(products.some((item) => item.id === Number(productId)));
      return Number(productId);
    },
    async demoteAutomaticPrimary(productId) {
      for (const item of state.memberships) {
        if (item.productId === productId && item.assignmentSource !== "MANUAL") {
          item.isPrimary = false;
        }
      }
    },
    async upsertMembership(input) {
      const category = categories.find((item) => item.id === input.customerCategoryId);
      const rule = rules.find((item) => (
        item.code === input.ruleCode && item.version === input.ruleVersion
      ));
      const mapped = {
        productId: input.productId,
        customerCategoryId: input.customerCategoryId,
        categorySlug: category.slug,
        parentSlug: category.parentId
          ? categories.find((item) => item.id === category.parentId)?.slug || null
          : null,
        isPrimary: input.isPrimary,
        assignmentSource: input.assignmentSource,
        assignmentOrigin: input.assignmentOrigin,
        ruleCode: input.ruleCode,
        ruleVersion: input.ruleVersion,
        confidence: input.confidence,
        approvalStatus: input.approvalStatus,
        categoryStatus: category.status,
        categoryIsActive: category.isActive,
        historicalRuleExists: input.ruleCode ? Boolean(rule) : null,
        historicalRuleIsActive: input.ruleCode ? Boolean(rule?.isActive) : null,
        historicalRuleTargetCategoryId: input.ruleCode
          ? rule?.targetCategoryId ?? null
          : null,
      };
      const index = state.memberships.findIndex((item) => (
        item.productId === input.productId
        && item.customerCategoryId === input.customerCategoryId
      ));
      if (index >= 0) state.memberships[index] = mapped;
      else state.memberships.push(mapped);
      return structuredClone(mapped);
    },
    async getBackfillVerification() {
      const primaryCount = new Map();
      for (const item of state.memberships) {
        if (!item.isPrimary) continue;
        primaryCount.set(item.productId, (primaryCount.get(item.productId) || 0) + 1);
      }
      return {
        memberships: state.memberships.length,
        duplicatePrimary: [...primaryCount.values()].filter((count) => count > 1).length,
      };
    },
  };
  return {
    state,
    commands,
    dbPool,
    repository,
    initialMemberships,
  };
}

function run(options = {}) {
  return runPhase3FBrakesBackfill({
    expectedHigh: 1,
    expectedSafe: 2,
    expectedHighProductId: 1,
    expectedHighArticle: "A1674216003",
    assignmentService: CustomerTaxonomyAssignmentService,
    ...options,
  });
}

test("PHASE 3F.5 parser is dry by default and APPLY needs exact confirmation", () => {
  assert.deepEqual(parsePhase3FBrakesBackfillArguments([]), {
    mode: "DRY_RUN",
    confirmation: null,
  });
  assert.throws(
    () => parsePhase3FBrakesBackfillArguments(["--apply"]),
    /requires --confirm=PHASE3F4_BRAKES_BACKFILL/,
  );
  assert.deepEqual(parsePhase3FBrakesBackfillArguments([
    "--apply",
    "--confirm=PHASE3F4_BRAKES_BACKFILL",
  ]), {
    mode: "APPLY",
    confirmation: PHASE3F_BRAKES_CONFIRMATION,
  });
});

test("PHASE 3F.5 dry-run, exact APPLY and repeat are safe and idempotent", async () => {
  const setup = fixture();
  const before = structuredClone(setup.state.memberships);
  const dry = await run({
    dbPool: setup.dbPool,
    repository: setup.repository,
  });
  assert.equal(dry.mode, "DRY_RUN");
  assert.deepEqual(dry.summary, {
    scopeProducts: 5,
    high: 1,
    safe: 2,
    unclassified: 2,
    realReview: 1,
    preservedApprovedPrimary: 2,
    idempotentNoop: false,
  });
  assert.deepEqual(dry.errors, []);
  assert.deepEqual(setup.state.memberships, before);
  assert.ok(setup.commands.includes("ROLLBACK"));

  const applied = await run({
    mode: "APPLY",
    confirmation: PHASE3F_BRAKES_CONFIRMATION,
    dbPool: setup.dbPool,
    repository: setup.repository,
  });
  assert.deepEqual(applied.applied, { high: 1, safe: 2, total: 3 });
  assert.deepEqual(applied.verification, {
    high: 1,
    safe: 2,
    total: 3,
    duplicatePrimary: 0,
  });
  const newMemberships = setup.state.memberships.filter((item) => item.productId <= 3);
  assert.equal(newMemberships.length, 3);
  assert.equal(newMemberships.every((item) => (
    item.assignmentOrigin === "BACKFILL"
    && item.approvalStatus === "AUTO_APPROVED"
    && item.isPrimary === true
  )), true);
  assert.equal(newMemberships.find((item) => item.productId === 1).categorySlug, "brakes-discs");
  assert.equal(newMemberships.find((item) => item.productId === 1).assignmentSource, "RULE");
  assert.equal(newMemberships.filter((item) => [2, 3].includes(item.productId)).every((item) => (
    item.categorySlug === "brakes"
    && item.assignmentSource === "EPC_FALLBACK"
    && item.confidence === "MEDIUM"
  )), true);
  assert.equal(setup.state.memberships.some((item) => item.productId === 4), false);
  assert.deepEqual(
    setup.state.memberships.filter((item) => [5, 6].includes(item.productId)),
    setup.initialMemberships,
  );

  const afterFirst = structuredClone(setup.state.memberships);
  const repeatedDry = await run({
    dbPool: setup.dbPool,
    repository: setup.repository,
  });
  assert.equal(repeatedDry.summary.high, 0);
  assert.equal(repeatedDry.summary.safe, 0);
  assert.equal(repeatedDry.summary.idempotentNoop, true);
  const repeatedApply = await run({
    mode: "APPLY",
    confirmation: PHASE3F_BRAKES_CONFIRMATION,
    dbPool: setup.dbPool,
    repository: setup.repository,
  });
  assert.deepEqual(repeatedApply.applied, { high: 0, safe: 0, total: 0 });
  assert.deepEqual(repeatedApply.verification, {
    high: 0,
    safe: 0,
    total: 0,
    duplicatePrimary: 0,
  });
  assert.equal(setup.commands.at(-1), "ROLLBACK");
  assert.deepEqual(setup.state.memberships, afterFirst);
});

test("PHASE 3F.5 count mismatch rolls back without changing memberships", async () => {
  const setup = fixture();
  const before = structuredClone(setup.state.memberships);
  await assert.rejects(
    run({
      mode: "APPLY",
      confirmation: PHASE3F_BRAKES_CONFIRMATION,
      expectedSafe: 3,
      dbPool: setup.dbPool,
      repository: setup.repository,
    }),
    (error) => (
      error instanceof CustomerTaxonomyPhase3FBrakesBackfillError
      && error.report.errors.includes("EXPECTED_SAFE_MISMATCH:3:2")
    ),
  );
  assert.ok(setup.commands.includes("ROLLBACK"));
  assert.deepEqual(setup.state.memberships, before);
});
