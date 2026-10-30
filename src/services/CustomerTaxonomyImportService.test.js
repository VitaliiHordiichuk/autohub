import assert from "node:assert/strict";
import test from "node:test";

import { CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION } from "./CustomerProductTypeDetector.js";
import {
  APPROVED_UNAMBIGUOUS_EPC_ROOT,
  CustomerTaxonomyImportIntegrityError,
  CustomerTaxonomyImportService,
} from "./CustomerTaxonomyImportService.js";
import { CUSTOMER_TAXONOMY_PHASE2E_REVIEW } from "../data/CustomerTaxonomyPhase2EReview.js";
import { CUSTOMER_TAXONOMY_PHASE2F_REVIEW } from "../data/CustomerTaxonomyPhase2FReview.js";
import { CUSTOMER_TAXONOMY_PHASE2G1_REVIEW } from "../data/CustomerTaxonomyPhase2G1Review.js";
import { CUSTOMER_TAXONOMY_PHASE2G2_REVIEW } from "../data/CustomerTaxonomyPhase2G2Review.js";
import { CUSTOMER_TAXONOMY_PHASE2G3_REVIEW } from "../data/CustomerTaxonomyPhase2G3Review.js";
import {
  CUSTOMER_TAXONOMY_DECISION,
} from "./CustomerTaxonomyResolver.js";

const db = { query: async () => ({ rows: [], rowCount: 0 }) };

test("every approved broad EPC root has a single reviewed direction and SAFE evidence", () => {
  const reviewed = [
    ...CUSTOMER_TAXONOMY_PHASE2E_REVIEW,
    ...CUSTOMER_TAXONOMY_PHASE2F_REVIEW,
    ...CUSTOMER_TAXONOMY_PHASE2G1_REVIEW,
    ...CUSTOMER_TAXONOMY_PHASE2G2_REVIEW,
    ...CUSTOMER_TAXONOMY_PHASE2G3_REVIEW,
  ];
  for (const [epc, section] of Object.entries(APPROVED_UNAMBIGUOUS_EPC_ROOT)) {
    const rows = reviewed.filter((row) => row.epc === epc);
    assert.ok(rows.some((row) => row.finalBucket === "SAFE_TOPLEVEL"), epc);
    assert.deepEqual(
      [...new Set(rows.map((row) => row.targetSection || row.section))],
      [section],
      epc,
    );
  }
  for (const epc of ["14", "22", "24", "32", "35", "90", "99"]) {
    assert.equal(APPROVED_UNAMBIGUOUS_EPC_ROOT[epc], undefined, epc);
  }
});

const categories = [
  { id: 100, slug: "filters-maintenance", parentId: null, status: "ACTIVE", isActive: true },
  { id: 101, slug: "filters-oil", parentId: 100, status: "ACTIVE", isActive: true },
  { id: 200, slug: "steering", parentId: null, status: "ACTIVE", isActive: true },
  { id: 300, slug: "engine", parentId: null, status: "ACTIVE", isActive: true },
  { id: 400, slug: "brakes", parentId: null, status: "ACTIVE", isActive: true },
  { id: 401, slug: "brakes-pads", parentId: 400, status: "ACTIVE", isActive: true },
  { id: 500, slug: "electrical-electronics-lighting", parentId: null, status: "ACTIVE", isActive: true },
  { id: 600, slug: "interior-safety", parentId: null, status: "ACTIVE", isActive: true },
  { id: 700, slug: "body-glass", parentId: null, status: "ACTIVE", isActive: true },
  { id: 800, slug: "cooling", parentId: null, status: "ACTIVE", isActive: true },
  { id: 801, slug: "cooling-hoses-pipes", parentId: 800, status: "ACTIVE", isActive: true },
  { id: 201, slug: "steering-tie-rods", parentId: 200, status: "ACTIVE", isActive: true },
  { id: 301, slug: "engine-sensors", parentId: 300, status: "ACTIVE", isActive: true },
  { id: 501, slug: "electrical-batteries", parentId: 500, status: "ACTIVE", isActive: true },
  { id: 900, slug: "exhaust", parentId: null, status: "ACTIVE", isActive: true },
  { id: 901, slug: "exhaust-adblue-scr", parentId: 900, status: "ACTIVE", isActive: true },
  { id: 902, slug: "exhaust-sensors", parentId: 900, status: "ACTIVE", isActive: true },
  { id: 1000, slug: "suspension", parentId: null, status: "ACTIVE", isActive: true },
  { id: 1001, slug: "suspension-subframes", parentId: 1000, status: "ACTIVE", isActive: true },
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

function brakePadRule() {
  return {
    id: 2,
    code: "TEST_BRAKE_PAD_A_EPC42",
    version: 1,
    detectorVersion: CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
    sourceKind: "RULE",
    assignmentRole: "PRIMARY",
    numberFamily: "A",
    epcGroup: "42",
    matchType: "TYPE_CODE",
    matchValue: "BRAKE_PAD",
    excludeValues: [],
    targetCategoryId: 401,
    targetCategorySlug: "brakes-pads",
    targetParentId: 400,
    targetParentSlug: "brakes",
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
  const state = { memberships: memberships.map((item) => ({ ...item })), decisions: [] };
  const repository = {
    async recordImportDecision(record) {
      state.decisions.push(record);
    },
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
  assert.equal(fixture.state.decisions[0].decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_NEW_HIGH);
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

test("SAFE, review and unsupported are distinct normal import outcomes", async () => {
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
  assert.equal(unclassified.decision, CUSTOMER_TAXONOMY_DECISION.REQUIRES_REVIEW);
  assert.equal(unclassified.reason, "NO_UNAMBIGUOUS_APPROVED_EPC_ROOT");
  assert.equal(unclassifiedFixture.state.memberships.length, 0);
  assert.deepEqual(unclassifiedFixture.state.decisions[0], {
    productId: 1,
    decision: CUSTOMER_TAXONOMY_DECISION.REQUIRES_REVIEW,
    reason: "NO_UNAMBIGUOUS_APPROVED_EPC_ROOT",
  });

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

test("approved single-root EPC assigns only the root when no narrow rule matches", async () => {
  for (const [epc, expected] of [
    ["82", "electrical-electronics-lighting"],
    ["92", "interior-safety"],
    ["67", "body-glass"],
  ]) {
    const fixture = repositoryFixture({
      currentProduct: product({
        article: `A998${epc}00001`,
        articleNormalized: `A998${epc}00001`,
        name: "Деталь",
        technicalEpcGroups: [epc],
      }),
      rules: [],
    });
    const result = await classify(fixture);
    assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_SAFE);
    assert.equal(result.finalCategory, expected);
    assert.equal(fixture.state.memberships[0].assignmentSource, "EPC_FALLBACK");
    assert.equal(fixture.state.memberships[0].confidence, "MEDIUM");
    assert.equal(fixture.state.memberships[0].parentSlug, null);
  }
});

test("mixed, absent, and conflicting EPC evidence stays unassigned for review", async () => {
  for (const [epc, name, rules, reason] of [
    [["24"], "Деталь", [], "NO_UNAMBIGUOUS_APPROVED_EPC_ROOT"],
    [[], "Деталь", [], "NO_TECHNICAL_EPC"],
    [["82", "92"], "Деталь", [], "MULTIPLE_OR_UNAPPROVED_TECHNICAL_EPC"],
    [["82", "90"], "Деталь", [], "MULTIPLE_OR_UNAPPROVED_TECHNICAL_EPC"],
    [["82"], "Гальмівні колодки", [brakePadRule()], "EPC_NAME_SECTION_CONFLICT"],
  ]) {
    const fixture = repositoryFixture({
      currentProduct: product({
        article: "A9980000001",
        articleNormalized: "A9980000001",
        name,
        technicalEpcGroups: epc,
      }),
      rules,
    });
    const result = await classify(fixture);
    assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.REQUIRES_REVIEW);
    assert.match(result.reason, new RegExp(reason));
    assert.equal(fixture.state.memberships.length, 0);
  }
});

test("even a narrow rule cannot auto-assign when EPC evidence is absent or contradictory", async () => {
  const article = "A9981800001";
  const articleRule = {
    ...oilFilterRule(), matchType: "ARTICLE_EXACT",
    matchValue: article, epcGroup: null,
  };
  for (const [epc, rules, reason] of [
    [[], [articleRule], "NO_TECHNICAL_EPC"],
    [["18", "82"], [oilFilterRule()], "MULTIPLE_OR_UNAPPROVED_TECHNICAL_EPC"],
  ]) {
    const fixture = repositoryFixture({
      currentProduct: product({ article, articleNormalized: article,
        name: "Фільтр масляний", technicalEpcGroups: epc }),
      rules,
    });
    const result = await classify(fixture);
    assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.REQUIRES_REVIEW);
    assert.equal(result.reason, reason);
    assert.equal(fixture.state.memberships.length, 0);
  }
});

test("new root fallback never replaces an approved manual primary", async () => {
  const existing = membership({
    categoryId: 300,
    categorySlug: "engine",
    source: "MANUAL",
    origin: "ADMIN",
    confidence: "HIGH",
    approvalStatus: "MANUAL_APPROVED",
  });
  const fixture = repositoryFixture({
    currentProduct: product({
      article: "A9988200001",
      articleNormalized: "A9988200001",
      name: "Деталь",
      technicalEpcGroups: ["82"],
    }),
    memberships: [existing],
    rules: [],
  });
  const before = structuredClone(fixture.state.memberships);
  const result = await classify(fixture);
  assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.PRESERVE_MANUAL);
  assert.deepEqual(fixture.state.memberships, before);
});

test("the twelve 29 October import products keep precise leaves or receive only safe roots", async () => {
  const coolingRule = {
    ...oilFilterRule(), code: "COOLING_HOSE_PIPE_A_EPC20_PHASE2E_V1",
    epcGroup: "20", matchValue: "COOLING_HOSE_PIPE",
    targetCategoryId: 801, targetCategorySlug: "cooling-hoses-pipes",
    targetParentId: 800, targetParentSlug: "cooling",
  };
  const steeringRule = {
    ...oilFilterRule(), code: "STEERING_TIE_ROD_A_EPC46_V1",
    epcGroup: "46", matchValue: "STEERING_TIE_ROD",
    targetCategoryId: 201, targetCategorySlug: "steering-tie-rods",
    targetParentId: 200, targetParentSlug: "steering",
  };
  const scenarios = [
    ["A6541400505", "Abgasrueckfuehrkuehler", "14", null],
    ["A4643261300", "Befestigungsbuegel", "32", null],
    ["A6542261100", "Geraeuschisolierung", "22", null],
    ["A2052406717", "Motorlager", "24", null],
    ["A2239002334", "Steuergeraet", "90", null],
    ["A2479000219", "Steuergeraet", "90", null],
    ["A0008208112", "Електропривід замка", "82", "electrical-electronics-lighting"],
    ["A2053510042", "Опора підрамника", "35", null],
    ["A2742000300", "Патрубок системи охолодження", "20", "cooling-hoses-pipes"],
    ["A29792048049H93", "Подушка спинки сидіння", "92", "interior-safety"],
    ["A6541403200", "Exhaust gas heat exchanger", "14", null],
    ["A2974608700", "Тяга кермова", "46", "steering-tie-rods"],
  ];
  for (const [article, name, epc, expected] of scenarios) {
    const fixture = repositoryFixture({
      currentProduct: product({
        article, articleNormalized: article, name,
        technicalEpcGroups: [epc],
      }),
      rules: [coolingRule, steeringRule],
    });
    const result = await classify(fixture);
    assert.equal(result.finalCategory, expected, article);
    assert.equal(fixture.state.memberships.length, expected ? 1 : 0, article);
    if (!expected) assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.REQUIRES_REVIEW);
  }
});

test("owner-approved part semantics classify current examples and future analogues without article allowlists", async () => {
  const rule = (code, epc, type, id, slug, parentId, parentSlug) => ({
    ...oilFilterRule(), code, epcGroup: epc, matchValue: type,
    targetCategoryId: id, targetCategorySlug: slug,
    targetParentId: parentId, targetParentSlug: parentSlug,
  });
  const rules = [
    rule("ELECTRICAL_BATTERY_A_EPC98_PHASE2G2_V1", "98", "ELECTRICAL_BATTERY", 501, "electrical-batteries", 500, "electrical-electronics-lighting"),
    rule("EXHAUST_SENSOR_A_EPC90_V1", "90", "EXHAUST_SENSOR", 902, "exhaust-sensors", 900, "exhaust"),
    rule("SUSPENSION_SUBFRAME_MOUNT_A_EPC35_PHASE2F_V1", "35", "SUSPENSION_SUBFRAME_MOUNT", 1001, "suspension-subframes", 1000, "suspension"),
    rule("ADBLUE_SCR_COMPONENT_A_EPC14_EXPLICIT_V1", "14", "ADBLUE_SCR_COMPONENT", 901, "exhaust-adblue-scr", 900, "exhaust"),
    rule("ADBLUE_SCR_COMPONENT_A_EPC15_EXPLICIT_V1", "15", "ADBLUE_SCR_COMPONENT", 901, "exhaust-adblue-scr", 900, "exhaust"),
    rule("ADBLUE_SCR_COMPONENT_A_EPC90_EXPLICIT_V1", "90", "ADBLUE_SCR_COMPONENT", 901, "exhaust-adblue-scr", 900, "exhaust"),
    rule("ADBLUE_SCR_COMPONENT_A_EPC98_EXPLICIT_V1", "98", "ADBLUE_SCR_COMPONENT", 901, "exhaust-adblue-scr", 900, "exhaust"),
    rule("ENGINE_PRESSURE_VALVE_A_EPC15_EXPLICIT_V1", "15", "ENGINE_SENSOR", 301, "engine-sensors", 300, "engine"),
  ];
  const cases = [
    ["A001982790826", "Акумулятор 12V/60ah", "98", "electrical-batteries"],
    ["A0009053119", "Датчик NOX", "90", "exhaust-sensors"],
    ["A212350380564", "Балка моста заднього", "35", "suspension-subframes"],
    ["A000140447880", "Насос системи AdBlue", "14", "exhaust-adblue-scr"],
    ["A000989980911", "Реагент AdBlue", "98", "exhaust-adblue-scr"],
    ["A0001532000", "Клапан тиску", "15", "engine-sensors"],
    ["A0001532600", "Клапан давления", "15", "engine-sensors"],
    ["A8889000001", "NOx sensor", "90", "exhaust-sensors"],
    ["A8883500001", "Rear axle beam", "35", "suspension-subframes"],
    ["A8881400001", "AdBlue pump", "14", "exhaust-adblue-scr"],
    ["A8889000002", "Датчик тиску системи AdBlue", "90", "exhaust-adblue-scr"],
    ["A8881500001", "Pressure valve", "15", "engine-sensors"],
  ];
  for (const [article, name, epc, expected] of cases) {
    const fixture = repositoryFixture({
      currentProduct: product({ article, articleNormalized: article, name, technicalEpcGroups: [epc] }),
      rules,
    });
    const result = await classify(fixture);
    assert.equal(result.finalCategory, expected, article);
    assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_NEW_HIGH, article);
    assert.equal(fixture.state.memberships.length, 1, article);
    assert.equal(fixture.state.memberships[0].confidence, "HIGH", article);
  }
  const protectedFixture = repositoryFixture({
    currentProduct: product({ article: "A0009053119", articleNormalized: "A0009053119", name: "Датчик NOX", technicalEpcGroups: ["90"] }),
    rules,
    memberships: [membership({
      categoryId: 101, categorySlug: "filters-oil", source: "MANUAL", origin: "MANUAL",
      confidence: "HIGH", approvalStatus: "MANUAL_APPROVED",
    })],
  });
  const result = await classify(protectedFixture);
  assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.PRESERVE_MANUAL);
  assert.equal(protectedFixture.state.memberships[0].categorySlug, "filters-oil");
  assert.equal(protectedFixture.state.memberships.length, 1);
});

test("reviewed EPC 42 and 43 assign only the SAFE brakes root", async () => {
  for (const epc of ["42", "43"]) {
    const fixture = repositoryFixture({
      currentProduct: product({
        article: `A998${epc}00001`,
        articleNormalized: `A998${epc}00001`,
        name: "Деталь",
        technicalEpcGroups: [epc],
      }),
      rules: [],
    });
    const result = await classify(fixture);
    assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_SAFE);
    assert.equal(result.finalCategory, "brakes");
    assert.equal(fixture.state.memberships.length, 1);
    assert.equal(fixture.state.memberships[0].assignmentSource, "EPC_FALLBACK");
    assert.equal(fixture.state.memberships[0].assignmentOrigin, "IMPORT");
    assert.equal(fixture.state.memberships[0].confidence, "MEDIUM");
    assert.equal(fixture.state.memberships[0].approvalStatus, "AUTO_APPROVED");
  }
});

test("a HIGH EPC 42 proposal wins before the SAFE brakes fallback", async () => {
  const fixture = repositoryFixture({
    currentProduct: product({
      article: "A9984200002",
      articleNormalized: "A9984200002",
      name: "Колодки гальмівні",
      technicalEpcGroups: ["42"],
    }),
    rules: [brakePadRule()],
  });
  const result = await classify(fixture);
  assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.ASSIGNED_NEW_HIGH);
  assert.equal(result.finalCategory, "brakes-pads");
  assert.equal(fixture.state.memberships.length, 1);
  assert.equal(fixture.state.memberships[0].assignmentSource, "RULE");
  assert.equal(fixture.state.memberships[0].confidence, "HIGH");
  assert.equal(fixture.state.memberships[0].ruleCode, "TEST_BRAKE_PAD_A_EPC42");
});

test("reviewed EPC 42 and 43 REAL_REVIEW products never receive SAFE fallback", async () => {
  const cases = [
    {
      article: "A0004210887",
      name: "Ущільнювач",
      epc: "42",
    },
    {
      article: "A0004312071",
      name: "Гвинт",
      epc: "43",
    },
  ];
  for (const scenario of cases) {
    const fixture = repositoryFixture({
      currentProduct: product({
        article: scenario.article,
        articleNormalized: scenario.article,
        name: scenario.name,
        technicalEpcGroups: [scenario.epc],
      }),
      rules: [],
    });
    const result = await classify(fixture);
    assert.equal(result.decision, CUSTOMER_TAXONOMY_DECISION.REQUIRES_REVIEW);
    assert.match(result.reason, /PHASE_2G3_REAL_REVIEW/);
    assert.equal(fixture.state.memberships.length, 0);
  }
});

test("EPC 42 SAFE fallback preserves approved and MANUAL primary memberships", async () => {
  const existingCases = [
    membership({
      categoryId: 300,
      categorySlug: "engine",
      source: "MANUAL",
      origin: "ADMIN",
      confidence: "HIGH",
      approvalStatus: "MANUAL_APPROVED",
    }),
    membership({
      categoryId: 100,
      categorySlug: "filters-maintenance",
      source: "EPC_FALLBACK",
      origin: "BACKFILL",
      confidence: "MEDIUM",
      approvalStatus: "AUTO_APPROVED",
    }),
  ];
  for (const existing of existingCases) {
    const fixture = repositoryFixture({
      currentProduct: product({
        article: "A9984200003",
        articleNormalized: "A9984200003",
        name: "Деталь",
        technicalEpcGroups: ["42"],
      }),
      rules: [],
      memberships: [existing],
    });
    const before = structuredClone(fixture.state.memberships);
    const result = await classify(fixture);
    assert.equal(result.preservedExisting, true);
    assert.deepEqual(fixture.state.memberships, before);
  }
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
