import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
  CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION,
  CustomerTaxonomyBackfillError,
  parseCustomerTaxonomyBackfillArguments,
  runCustomerTaxonomyBackfill,
} from "./CustomerTaxonomyBackfillService.js";
import { CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION } from "./CustomerProductTypeDetector.js";

function fakePool() {
  const commands = [];
  const client = {
    async query(sql) {
      commands.push(String(sql).trim());
      return { rows: [], rowCount: 0 };
    },
    release() {
      commands.push("RELEASE");
    },
  };
  return { commands, connect: async () => client };
}

function rule(overrides = {}) {
  return {
    id: 1,
    code: "BACKFILL_FILTER_OIL_V1",
    version: 1,
    detectorVersion: CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
    sourceKind: "RULE",
    assignmentRole: "PRIMARY",
    numberFamily: "A",
    epcGroup: "18",
    matchType: "TYPE_CODE",
    matchValue: "FILTER_OIL",
    excludeValues: [],
    targetCategoryId: 100,
    targetCategorySlug: "filters-oil",
    targetParentId: 10,
    targetParentSlug: "filters-maintenance",
    targetStatus: "ACTIVE",
    targetIsActive: true,
    priority: 100,
    confidence: "HIGH",
    autoApprovalAllowed: true,
    isActive: true,
    ...overrides,
  };
}

function fixture({ rules = [rule()], memberships = [], products: fixtureProducts } = {}) {
  const products = fixtureProducts || [{
    id: 7,
    article: "A0001800109",
    articleNormalized: "A0001800109",
    name: "Фільтр оливи",
    technicalEpcGroups: ["18"],
  }];
  const repository = {
    listProductsForPreview: async () => products,
    listActiveRules: async () => rules,
    listMemberships: async () => memberships,
    listMembershipsForProduct: async (productId) => (
      memberships.filter((membership) => membership.productId === productId)
    ),
    listCategoriesBySlugs: async () => [{
      id: 300,
      slug: "steering",
      parentId: null,
      status: "ACTIVE",
      isActive: true,
    }, {
      id: 301,
      slug: "exhaust",
      parentId: null,
      status: "ACTIVE",
      isActive: true,
    }, {
      id: 302,
      slug: "wheels",
      parentId: null,
      status: "ACTIVE",
      isActive: true,
    }],
    lockProductForAssignment: async () => 7,
    getBackfillVerification: async () => ({
      memberships: memberships.length,
      approvedPrimary: memberships.filter((item) => item.isPrimary).length,
      primary: memberships.filter((item) => item.isPrimary).length,
      rule: memberships.filter((item) => item.assignmentSource === "RULE").length,
      epcFallback: memberships.filter((item) => (
        item.assignmentSource === "EPC_FALLBACK"
      )).length,
      backfill: memberships.filter((item) => item.assignmentOrigin === "BACKFILL").length,
      high: memberships.filter((item) => item.confidence === "HIGH").length,
      medium: memberships.filter((item) => item.confidence === "MEDIUM").length,
      autoApproved: memberships.filter((item) => item.approvalStatus === "AUTO_APPROVED").length,
      review: memberships.filter((item) => item.approvalStatus === "REVIEW").length,
      duplicatePrimary: 0,
      orphanRule: 0,
      inactiveTarget: 0,
    }),
  };
  const assignmentService = {
    async applyResolutionInTransaction({ productId, resolution }) {
      const proposal = resolution.proposals[0];
      const membership = {
        productId,
        customerCategoryId: proposal.category.id,
        categorySlug: proposal.category.slug,
        parentSlug: proposal.category.parentSlug,
        isPrimary: true,
        assignmentSource: proposal.assignmentSource,
        assignmentOrigin: proposal.assignmentOrigin,
        ruleCode: proposal.ruleCode,
        ruleVersion: proposal.ruleVersion,
        confidence: proposal.confidence,
        approvalStatus: proposal.approvalStatus,
      };
      const index = memberships.findIndex((item) => (
        item.productId === productId
        && item.customerCategoryId === proposal.category.id
      ));
      if (index >= 0) memberships[index] = membership;
      else memberships.push(membership);
      return { applied: [membership] };
    },
  };
  return { repository, assignmentService, memberships };
}

test("default invocation is DRY_RUN and --apply requires explicit confirmation", async () => {
  assert.deepEqual(parseCustomerTaxonomyBackfillArguments([]), {
    mode: "DRY_RUN",
    expectedCount: null,
    confirmation: null,
    includeSafeTopLevel: false,
  });
  assert.throws(
    () => parseCustomerTaxonomyBackfillArguments(["--apply"]),
    /--confirm=AUTO_APPROVED_ONLY/,
  );
  assert.throws(
    () => parseCustomerTaxonomyBackfillArguments([
      "--include-safe-top-level",
      "--apply",
      "--confirm=AUTO_APPROVED_ONLY",
    ]),
    /--confirm=SAFE_TOPLEVEL_EPC_FALLBACK/,
  );
  const dbPool = fakePool();
  const { repository, assignmentService, memberships } = fixture();
  const report = await runCustomerTaxonomyBackfill({
    dbPool,
    repository,
    assignmentService,
  });
  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.candidateCount, 1);
  assert.equal(report.wouldInsert, 1);
  assert.equal(memberships.length, 0);
  assert.ok(dbPool.commands.includes("ROLLBACK"));
});

test("wrong expected count aborts APPLY with zero writes", async () => {
  const { repository, assignmentService, memberships } = fixture();
  await assert.rejects(runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 2,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: fakePool(),
    repository,
    assignmentService,
  }), (error) => {
    assert.ok(error instanceof CustomerTaxonomyBackfillError);
    assert.ok(error.report.errors.includes("EXPECTED_COUNT_MISMATCH:2:1"));
    return true;
  });
  assert.equal(memberships.length, 0);
});

test("correct APPLY persists RULE + BACKFILL and the second APPLY is idempotent", async () => {
  const state = fixture();
  const first = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  assert.equal(first.inserted, 1);
  assert.equal(first.updated, 0);
  assert.equal(state.memberships[0].assignmentSource, "RULE");
  assert.equal(state.memberships[0].assignmentOrigin, "BACKFILL");
  assert.equal(state.memberships[0].isPrimary, true);

  const second = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(state.memberships.length, 1);
});

test("MANUAL and REJECTED decisions are preserved", async () => {
  const manualState = fixture({ memberships: [{
    productId: 7,
    customerCategoryId: 200,
    isPrimary: true,
    assignmentSource: "MANUAL",
    assignmentOrigin: "ADMIN",
    ruleCode: null,
    ruleVersion: null,
    confidence: "HIGH",
    approvalStatus: "MANUAL_APPROVED",
  }] });
  const manualReport = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: fakePool(),
    repository: manualState.repository,
    assignmentService: manualState.assignmentService,
  });
  assert.equal(manualReport.candidateCount, 0);
  assert.equal(manualReport.manualPreserved, 1);
  assert.equal(manualState.memberships[0].assignmentSource, "MANUAL");

  const rejectedState = fixture({ memberships: [{
    productId: 7,
    customerCategoryId: 100,
    isPrimary: false,
    assignmentSource: "RULE",
    assignmentOrigin: "ADMIN",
    ruleCode: "BACKFILL_FILTER_OIL_V1",
    ruleVersion: 1,
    confidence: "HIGH",
    approvalStatus: "REJECTED",
  }] });
  const rejectedReport = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: fakePool(),
    repository: rejectedState.repository,
    assignmentService: rejectedState.assignmentService,
  });
  assert.equal(rejectedReport.rejectedPreserved, 1);
  assert.equal(rejectedState.memberships[0].approvalStatus, "REJECTED");
});

test("REVIEW, conflict, and detector mismatch abort before writes", async () => {
  const scenarios = [{
    resolver: () => ({
      typeCodes: [],
      manualPrimaryPreserved: false,
      unclassified: false,
      diagnostics: [],
      conflicts: [],
      proposals: [{
        category: { id: 100, slug: "filters-oil", parentSlug: "filters-maintenance" },
        assignmentSource: "RULE",
        assignmentOrigin: "BACKFILL",
        ruleCode: "BACKFILL_FILTER_OIL_V1",
        ruleVersion: 1,
        confidence: "MEDIUM",
        approvalStatus: "REVIEW",
        isPrimary: false,
      }],
    }),
    error: "REVIEW:1",
  }, {
    resolver: () => ({
      typeCodes: [],
      manualPrimaryPreserved: false,
      unclassified: false,
      diagnostics: [],
      conflicts: [{ reason: "EQUAL_PRIMARY_STRENGTH" }],
      proposals: [],
    }),
    error: "CONFLICTS:1",
  }];
  for (const scenario of scenarios) {
    const state = fixture();
    await assert.rejects(runCustomerTaxonomyBackfill({
      mode: "APPLY",
      confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
      dbPool: fakePool(),
      repository: state.repository,
      assignmentService: state.assignmentService,
      resolver: scenario.resolver,
    }), (error) => error.report.errors.includes(scenario.error));
    assert.equal(state.memberships.length, 0);
  }

  const mismatch = fixture({
    rules: [rule({ detectorVersion: CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION - 1 })],
  });
  await assert.rejects(runCustomerTaxonomyBackfill({
    mode: "APPLY",
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: fakePool(),
    repository: mismatch.repository,
    assignmentService: mismatch.assignmentService,
  }), (error) => error.report.errors.some((item) => (
    item.startsWith("DETECTOR_VERSION_MISMATCH:")
  )));
  assert.equal(mismatch.memberships.length, 0);
});

test("disabled rules and inactive categories never create memberships", async () => {
  const disabled = fixture({ rules: [] });
  const disabledReport = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: fakePool(),
    repository: disabled.repository,
    assignmentService: disabled.assignmentService,
  });
  assert.equal(disabledReport.candidateCount, 0);
  assert.equal(disabled.memberships.length, 0);

  const inactive = fixture({ rules: [rule({ targetIsActive: false })] });
  const inactiveReport = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: fakePool(),
    repository: inactive.repository,
    assignmentService: inactive.assignmentService,
  });
  assert.equal(inactiveReport.candidateCount, 0);
  assert.equal(inactive.memberships.length, 0);
});

test("SAFE_TOPLEVEL is opt-in, uses EPC_FALLBACK + BACKFILL + MEDIUM and is idempotent", async () => {
  const state = fixture({
    rules: [],
    products: [{
      id: 7,
      article: "A0004600001",
      articleNormalized: "A0004600001",
      name: "Хомут",
      technicalEpcGroups: ["46"],
    }],
  });
  const defaultReport = await runCustomerTaxonomyBackfill({
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  assert.equal(defaultReport.candidateCount, 0);
  assert.equal(defaultReport.summary.safeTopLevelEpcFallback, 0);

  const dryRun = await runCustomerTaxonomyBackfill({
    includeSafeTopLevel: true,
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  assert.equal(dryRun.candidateCount, 1);
  assert.equal(dryRun.summary.safeTopLevelCandidates.steering, 1);
  assert.equal(dryRun.summary.wouldInsertSafeTopLevel, 1);
  assert.equal(state.memberships.length, 0);

  const applied = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION,
    includeSafeTopLevel: true,
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  assert.equal(applied.insertedSafeTopLevel, 1);
  assert.deepEqual(state.memberships[0], {
    productId: 7,
    customerCategoryId: 300,
    categorySlug: "steering",
    parentSlug: null,
    isPrimary: true,
    assignmentSource: "EPC_FALLBACK",
    assignmentOrigin: "BACKFILL",
    ruleCode: null,
    ruleVersion: null,
    confidence: "MEDIUM",
    approvalStatus: "AUTO_APPROVED",
  });

  const repeated = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 1,
    confirmation: CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION,
    includeSafeTopLevel: true,
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  assert.equal(repeated.inserted, 0);
  assert.equal(repeated.updated, 0);
  assert.equal(repeated.unchanged, 1);
});

test("SAFE_TOPLEVEL keeps the three confirmed REAL_REVIEW products unassigned", async () => {
  const state = fixture({
    rules: [],
    products: [{
      id: 71,
      article: "A2214600325",
      articleNormalized: "A2214600325",
      name: "GETRIEBE",
      technicalEpcGroups: ["46"],
    }, {
      id: 72,
      article: "A9014600104",
      articleNormalized: "A9014600104",
      name: "Корпус замка запалювання",
      technicalEpcGroups: ["46"],
    }, {
      id: 73,
      article: "A0014012713",
      articleNormalized: "A0014012713",
      name: "Золотникдатчик",
      technicalEpcGroups: ["40"],
    }],
  });
  const report = await runCustomerTaxonomyBackfill({
    includeSafeTopLevel: true,
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  assert.equal(report.summary.safeTopLevelEpcFallback, 0);
  assert.equal(report.summary.realReview, 3);
  assert.deepEqual(
    report.realReview.map((item) => item.article).sort(),
    ["A0014012713", "A2214600325", "A9014600104"],
  );
  assert.equal(state.memberships.length, 0);
});

test("SAFE_TOPLEVEL preserves existing HIGH and MANUAL primary memberships", async () => {
  const existingHigh = {
    productId: 7,
    customerCategoryId: 100,
    categorySlug: "filters-oil",
    parentSlug: "filters-maintenance",
    isPrimary: true,
    assignmentSource: "RULE",
    assignmentOrigin: "BACKFILL",
    ruleCode: "BACKFILL_FILTER_OIL_V1",
    ruleVersion: 1,
    confidence: "HIGH",
    approvalStatus: "AUTO_APPROVED",
  };
  const existingManual = {
    productId: 9,
    customerCategoryId: 999,
    categorySlug: "manual-category",
    parentSlug: "brakes",
    isPrimary: true,
    assignmentSource: "MANUAL",
    assignmentOrigin: "ADMIN",
    ruleCode: null,
    ruleVersion: null,
    confidence: "HIGH",
    approvalStatus: "MANUAL_APPROVED",
  };
  const state = fixture({
    memberships: [existingHigh, existingManual],
    products: [{
      id: 7,
      article: "A0001800109",
      articleNormalized: "A0001800109",
      name: "Фільтр оливи",
      technicalEpcGroups: ["18"],
    }, {
      id: 8,
      article: "A0004600001",
      articleNormalized: "A0004600001",
      name: "Хомут",
      technicalEpcGroups: ["46"],
    }, {
      id: 9,
      article: "A0004900001",
      articleNormalized: "A0004900001",
      name: "Прокладка",
      technicalEpcGroups: ["49"],
    }],
  });
  const beforeHigh = { ...existingHigh };
  const beforeManual = { ...existingManual };
  const report = await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    expectedCount: 3,
    confirmation: CUSTOMER_TAXONOMY_SAFE_TOPLEVEL_CONFIRMATION,
    includeSafeTopLevel: true,
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  assert.equal(report.insertedSafeTopLevel, 1);
  assert.equal(report.manualPreserved, 1);
  assert.equal(report.unchanged, 1);
  assert.deepEqual(state.memberships.find((item) => item.productId === 7), beforeHigh);
  assert.deepEqual(state.memberships.find((item) => item.productId === 9), beforeManual);
});

test("VERIFY is read-only and validates the persisted controlled membership", async () => {
  const state = fixture();
  await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  const dbPool = fakePool();
  const report = await runCustomerTaxonomyBackfill({
    mode: "VERIFY",
    expectedCount: 1,
    dbPool,
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  assert.equal(report.errors.length, 0);
  assert.equal(report.verification.memberships, 1);
  assert.equal(report.verification.backfill, 1);
  assert.ok(dbPool.commands.includes("BEGIN READ ONLY"));
  assert.ok(dbPool.commands.includes("ROLLBACK"));
  assert.equal(dbPool.commands.includes("COMMIT"), false);
});

test("VERIFY exposes global and candidate-scoped provenance counts", async () => {
  const state = fixture();
  await runCustomerTaxonomyBackfill({
    mode: "APPLY",
    confirmation: CUSTOMER_TAXONOMY_BACKFILL_CONFIRMATION,
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  const report = await runCustomerTaxonomyBackfill({
    mode: "VERIFY",
    expectedCount: 1,
    dbPool: fakePool(),
    repository: state.repository,
    assignmentService: state.assignmentService,
  });
  assert.equal(report.errors.length, 0);
  assert.deepEqual(report.candidateVerification, {
    memberships: 1,
    primary: 1,
    rule: 1,
    epcFallback: 0,
    high: 1,
    medium: 0,
    autoApproved: 1,
    review: 0,
  });
  assert.equal(report.verification.epcFallback, 0);
  assert.equal(report.verification.medium, 0);
  assert.equal(report.verification.review, 0);
});
