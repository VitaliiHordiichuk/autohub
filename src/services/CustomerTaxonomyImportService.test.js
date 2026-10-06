import assert from "node:assert/strict";
import test from "node:test";

import { CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION } from "./CustomerProductTypeDetector.js";
import {
  CustomerTaxonomyImportIntegrityError,
  CustomerTaxonomyImportService,
} from "./CustomerTaxonomyImportService.js";
import {
  CUSTOMER_TAXONOMY_DECISION,
} from "./CustomerTaxonomyResolver.js";

const db = { query: async () => ({ rows: [], rowCount: 0 }) };

const categories = [
  { id: 100, slug: "filters-maintenance", parentId: null, status: "ACTIVE", isActive: true },
  { id: 101, slug: "filters-oil", parentId: 100, status: "ACTIVE", isActive: true },
  { id: 200, slug: "steering", parentId: null, status: "ACTIVE", isActive: true },
  { id: 300, slug: "engine", parentId: null, status: "ACTIVE", isActive: true },
];

function oilFilterRule() {
  return {
    id: 1,
    code: "TEST_FILTER_OIL_A_EPC18",
    version: 1,
    detectorVersion: CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
    sourceKind: "RULE",
    assignmentRole: "PRIMARY",
    numberFamily: "A",
    epcGroup: "18",
    matchType: "TYPE_CODE",
    matchValue: "FILTER_OIL",
    excludeValues: [],
    targetCategoryId: 101,
    targetCategorySlug: "filters-oil",
    targetParentId: 100,
    targetParentSlug: "filters-maintenance",
    targetStatus: "ACTIVE",
    targetIsActive: true,
    priority: 100,
    confidence: "HIGH",
    autoApprovalAllowed: true,
    isActive: true,
  };
}

function product(overrides = {}) {
  return {
    id: 1,
    article: "A9981800001",
    articleNormalized: "A9981800001",
    name: "Фільтр масляний",
    brandId: 1,
    brandName: "Mercedes-Benz",
    technicalEpcGroups: ["18"],
    technicalCategories: [],
    ...overrides,
  };
}

function membership({
  categoryId,
  categorySlug,
  source,
  origin,
  confidence,
  approvalStatus,
  ruleCode = null,
  ruleVersion = null,
  historicalRuleExists = null,
  historicalRuleIsActive = null,
  historicalRuleTargetCategoryId = null,
}) {
  const category = categories.find((item) => item.id === categoryId);
  return {
    productId: 1,
    customerCategoryId: categoryId,
    categorySlug,
    parentSlug: category?.parentId
      ? categories.find((item) => item.id === category.parentId)?.slug || null
      : null,
    isPrimary: true,
    assignmentSource: source,
    assignmentOrigin: origin,
    ruleCode,
    ruleVersion,
    confidence,
    approvalStatus,
    categoryStatus: "ACTIVE",
    categoryIsActive: true,
    historicalRuleExists,
    historicalRuleIsActive,
    historicalRuleTargetCategoryId,
  };
}

function repositoryFixture({
  currentProduct = product(),
  rules = [oilFilterRule()],
  memberships = [],
} = {}) {
  const state = { memberships: memberships.map((item) => ({ ...item })) };
  const repository = {
    async lockProductForAssignment(productId) {
      assert.equal(productId, currentProduct.id);
      return productId;
    },
    async findProductForResolution(productId) {
      return productId === currentProduct.id ? { ...currentProduct } : null;
    },
    async listMembershipsForProduct() {
      return state.memberships.map((item) => ({ ...item }));
    },
    async listActiveRules() {
      return rules.map((item) => ({ ...item }));
    },
    async listCategoriesBySlugs(slugs) {
      return categories.filter((item) => slugs.includes(item.slug));
    },
    async demoteAutomaticPrimary() {
      for (const item of state.memberships) {
        if (item.assignmentSource !== "MANUAL") item.isPrimary = false;
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
        categorySlug: category?.slug || null,
        parentSlug: category?.parentId
          ? categories.find((item) => item.id === category.parentId)?.slug || null
          : null,
        isPrimary: input.isPrimary,
        assignmentSource: input.assignmentSource,
        assignmentOrigin: input.assignmentOrigin,
        ruleCode: input.ruleCode,
        ruleVersion: input.ruleVersion,
        confidence: input.confidence,
        approvalStatus: input.approvalStatus,
        categoryStatus: category?.status || null,
        categoryIsActive: category?.isActive ?? null,
        historicalRuleExists: input.ruleCode ? Boolean(rule) : null,
        historicalRuleIsActive: input.ruleCode ? Boolean(rule?.isActive) : null,
        historicalRuleTargetCategoryId: input.ruleCode
          ? rule?.targetCategoryId ?? null
          : null,
      };
      const index = state.memberships.findIndex((item) => (
        item.customerCategoryId === input.customerCategoryId
      ));
      if (index >= 0) state.memberships[index] = mapped;
      else state.memberships.push(mapped);
      return { ...mapped };
    },
  };
  return { repository, state };
}

async function classify(fixture) {
  const context = await CustomerTaxonomyImportService.createContext({
    db,
    repository: fixture.repository,
  });
  return CustomerTaxonomyImportService.classifyProduct({
    productId: 1,
    context,
  }, {
    db,
    repository: fixture.repository,
  });
}

test("import orchestration assigns HIGH with IMPORT provenance and is idempotent", async () => {
  const fixture = repositoryFixture();
  const first = await classify(fixture);
  assert.equal(first.decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_NEW_HIGH);
  assert.equal(first.finalCategory, "filters-oil");
  assert.equal(first.ruleCode, "TEST_FILTER_OIL_A_EPC18");
  assert.equal(fixture.state.memberships.length, 1);
  assert.equal(fixture.state.memberships[0].assignmentOrigin, "IMPORT");
  assert.equal(fixture.state.memberships[0].assignmentSource, "RULE");

  const second = await classify(fixture);
  assert.equal(
    second.decision,
    CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
  );
  assert.equal(second.preservedExisting, true);
  assert.equal(fixture.state.memberships.length, 1);
});

test("SAFE, unclassified and unsupported are distinct normal import outcomes", async () => {
  const safeFixture = repositoryFixture({
    currentProduct: product({
      article: "A9984600002",
      articleNormalized: "A9984600002",
      name: "Деталь",
      technicalEpcGroups: ["46"],
    }),
    rules: [],
  });
  const safe = await classify(safeFixture);
  assert.equal(safe.decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_SAFE);
  assert.equal(safe.finalCategory, "steering");
  assert.equal(safeFixture.state.memberships[0].assignmentSource, "EPC_FALLBACK");
  assert.equal(safeFixture.state.memberships[0].assignmentOrigin, "IMPORT");
  assert.equal(safeFixture.state.memberships[0].confidence, "MEDIUM");

  const unclassifiedFixture = repositoryFixture({
    currentProduct: product({
      article: "A9989900003",
      articleNormalized: "A9989900003",
      name: "Деталь",
      technicalEpcGroups: ["99"],
    }),
    rules: [],
  });
  const unclassified = await classify(unclassifiedFixture);
  assert.equal(unclassified.decision, CUSTOMER_TAXONOMY_DECISION.UNCLASSIFIED);
  assert.equal(unclassifiedFixture.state.memberships.length, 0);

  const unsupportedFixture = repositoryFixture({
    currentProduct: product({
      article: "PHASE3E-OTHER",
      articleNormalized: "PHASE3EOTHER",
      name: "Деталь",
      brandId: 2,
      brandName: "MANN",
      technicalEpcGroups: [],
    }),
    rules: [],
  });
  const unsupported = await classify(unsupportedFixture);
  assert.equal(unsupported.decision, CUSTOMER_TAXONOMY_DECISION.UNSUPPORTED);
  assert.equal(unsupportedFixture.state.memberships.length, 0);
});

test("MANUAL, approved HIGH, SAFE and inactive historical assignments are preserved", async () => {
  const cases = [
    {
      expected: CUSTOMER_TAXONOMY_DECISION.PRESERVE_MANUAL,
      existing: membership({
        categoryId: 300,
        categorySlug: "engine",
        source: "MANUAL",
        origin: "ADMIN",
        confidence: "HIGH",
        approvalStatus: "MANUAL_APPROVED",
      }),
    },
    {
      expected: CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
      existing: membership({
        categoryId: 300,
        categorySlug: "engine",
        source: "RULE",
        origin: "BACKFILL",
        confidence: "HIGH",
        approvalStatus: "AUTO_APPROVED",
        ruleCode: "HISTORICAL_ENGINE",
        ruleVersion: 1,
        historicalRuleExists: true,
        historicalRuleIsActive: false,
        historicalRuleTargetCategoryId: 300,
      }),
    },
    {
      expected: CUSTOMER_TAXONOMY_DECISION.PRESERVE_EXISTING_APPROVED_PRIMARY,
      existing: membership({
        categoryId: 100,
        categorySlug: "filters-maintenance",
        source: "EPC_FALLBACK",
        origin: "BACKFILL",
        confidence: "MEDIUM",
        approvalStatus: "AUTO_APPROVED",
      }),
    },
  ];

  for (const scenario of cases) {
    const fixture = repositoryFixture({ memberships: [scenario.existing] });
    const before = structuredClone(fixture.state.memberships);
    const result = await classify(fixture);
    assert.equal(result.decision, scenario.expected);
    assert.equal(result.preservedExisting, true);
    assert.deepEqual(fixture.state.memberships, before);
  }
});

test("import never enables approved-primary override and rejects invalid primary state", async () => {
  const fixture = repositoryFixture();
  let assignmentInput = null;
  const assignmentService = {
    async applyResolutionInTransaction(input) {
      assignmentInput = input;
      return {
        decision: CUSTOMER_TAXONOMY_DECISION.NO_ACTION,
        decisionIssues: [],
        preservedApprovedPrimary: null,
        applied: [],
      };
    },
  };
  const context = await CustomerTaxonomyImportService.createContext({
    db,
    repository: fixture.repository,
  });
  await CustomerTaxonomyImportService.classifyProduct({ productId: 1, context }, {
    db,
    repository: fixture.repository,
    assignmentService,
  });
  assert.equal(Object.hasOwn(assignmentInput, "allowApprovedPrimaryReplacement"), false);
  assert.equal(assignmentInput.assignmentOrigin, "IMPORT");

  const invalid = repositoryFixture({
    memberships: [
      membership({
        categoryId: 100,
        categorySlug: "filters-maintenance",
        source: "EPC_FALLBACK",
        origin: "BACKFILL",
        confidence: "MEDIUM",
        approvalStatus: "AUTO_APPROVED",
      }),
      membership({
        categoryId: 300,
        categorySlug: "engine",
        source: "MANUAL",
        origin: "ADMIN",
        confidence: "HIGH",
        approvalStatus: "MANUAL_APPROVED",
      }),
    ],
  });
  await assert.rejects(
    classify(invalid),
    (error) => (
      error instanceof CustomerTaxonomyImportIntegrityError
      && error.code === "CUSTOMER_TAXONOMY_IMPORT_INTEGRITY"
      && error.issues.includes("MULTIPLE_PRIMARY")
    ),
  );
});
