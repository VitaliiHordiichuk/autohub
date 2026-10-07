import assert from "node:assert/strict";
import test from "node:test";

import { CustomerTaxonomyAssignmentService } from "./CustomerTaxonomyAssignmentService.js";
import {
  CustomerTaxonomyPhase3FAccessoriesBackfillError,
  PHASE3F6_ACCESSORIES_ALLOWLIST,
  PHASE3F6_ACCESSORIES_CONFIRMATION,
  parsePhase3FAccessoriesBackfillArguments,
  runPhase3FAccessoriesBackfill,
} from "./CustomerTaxonomyPhase3FAccessoriesBackfillService.js";

const categories = [
  { id: 10, slug: "accessories", parentId: null, status: "ACTIVE", isActive: true },
  { id: 20, slug: "engine", parentId: null, status: "ACTIVE", isActive: true },
];

function productsFromAllowlist() {
  return PHASE3F6_ACCESSORIES_ALLOWLIST.map((entry) => ({
    id: entry.productId,
    article: entry.article,
    articleNormalized: entry.article,
    name: `Product ${entry.productId}`,
    isActive: true,
    technicalEpcGroups: [entry.epc],
  }));
}

function membership({
  productId,
  categoryId,
  source = "EPC_FALLBACK",
  origin = "BACKFILL",
  confidence = "MEDIUM",
  approvalStatus = "AUTO_APPROVED",
  isPrimary = true,
  ruleCode = null,
  ruleVersion = null,
}) {
  const category = categories.find((item) => item.id === categoryId);
  return {
    productId,
    customerCategoryId: categoryId,
    categorySlug: category.slug,
    parentSlug: category.parentId === null
      ? null
      : categories.find((item) => item.id === category.parentId)?.slug || null,
    isPrimary,
    assignmentSource: source,
    assignmentOrigin: origin,
    ruleCode,
    ruleVersion,
    confidence,
    approvalStatus,
  };
}

function fixture({ failUpsertAt = null } = {}) {
  const state = {
    products: productsFromAllowlist(),
    memberships: [],
    category: structuredClone(categories[0]),
  };
  let transactionSnapshot = null;
  let upsertCalls = 0;
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
  const repository = {
    async lockAllowlistedProducts(productIds) {
      return state.products
        .filter((product) => productIds.includes(product.id))
        .map((product) => product.id);
    },
    async listAllowlistedProducts(productIds) {
      return structuredClone(state.products.filter((product) => (
        productIds.includes(product.id)
      )));
    },
    async listMembershipsForProducts(productIds) {
      return structuredClone(state.memberships.filter((item) => (
        productIds.includes(item.productId)
      )));
    },
    async getCategoryBySlug(slug) {
      return slug === state.category.slug ? structuredClone(state.category) : null;
    },
    async getGlobalIntegrity() {
      const primaryCounts = new Map();
      for (const item of state.memberships) {
        if (!item.isPrimary) continue;
        primaryCounts.set(item.productId, (primaryCounts.get(item.productId) || 0) + 1);
      }
      return {
        duplicatePrimary: [...primaryCounts.values()].filter((count) => count > 1).length,
      };
    },
    async lockProductForAssignment(productId) {
      assert.ok(state.products.some((product) => product.id === productId));
      return productId;
    },
    async listMembershipsForProduct(productId) {
      return structuredClone(state.memberships.filter((item) => (
        item.productId === productId
      )));
    },
    async demoteAutomaticPrimary(productId) {
      for (const item of state.memberships) {
        if (item.productId === productId && item.assignmentSource !== "MANUAL") {
          item.isPrimary = false;
        }
      }
    },
    async upsertMembership(input) {
      upsertCalls += 1;
      if (failUpsertAt !== null && upsertCalls === failUpsertAt) {
        throw new Error("injected membership write failure");
      }
      const mapped = membership({
        productId: input.productId,
        categoryId: input.customerCategoryId,
        source: input.assignmentSource,
        origin: input.assignmentOrigin,
        confidence: input.confidence,
        approvalStatus: input.approvalStatus,
        isPrimary: input.isPrimary,
        ruleCode: input.ruleCode,
        ruleVersion: input.ruleVersion,
      });
      const index = state.memberships.findIndex((item) => (
        item.productId === input.productId
        && item.customerCategoryId === input.customerCategoryId
      ));
      if (index >= 0) state.memberships[index] = mapped;
      else state.memberships.push(mapped);
      return structuredClone(mapped);
    },
  };
  return {
    state,
    commands,
    dbPool,
    repository,
    get upsertCalls() {
      return upsertCalls;
    },
  };
}

function run(setup, options = {}) {
  return runPhase3FAccessoriesBackfill({
    dbPool: setup.dbPool,
    repository: setup.repository,
    assignmentService: CustomerTaxonomyAssignmentService,
    ...options,
  });
}

test("PHASE 3F.6 is dry by default and APPLY requires the exact token", () => {
  assert.deepEqual(parsePhase3FAccessoriesBackfillArguments([]), {
    mode: "DRY_RUN",
    confirmation: null,
  });
  assert.throws(
    () => parsePhase3FAccessoriesBackfillArguments(["--apply"]),
    /requires --confirm=PHASE3F6_ACCESSORIES_ALLOWLIST/,
  );
  assert.deepEqual(parsePhase3FAccessoriesBackfillArguments([
    "--apply",
    "--confirm=PHASE3F6_ACCESSORIES_ALLOWLIST",
  ]), {
    mode: "APPLY",
    confirmation: PHASE3F6_ACCESSORIES_CONFIRMATION,
  });
});

test("PHASE 3F.6 dry-run validates exactly 32 candidates and writes nothing", async () => {
  const setup = fixture();
  const report = await run(setup);
  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.expectedCandidates, 32);
  assert.equal(report.productsFound, 32);
  assert.equal(report.candidates.length, 32);
  assert.equal(report.alreadyApplied.length, 0);
  assert.equal(report.idempotentNoop, false);
  assert.deepEqual(report.errors, []);
  assert.equal(setup.state.memberships.length, 0);
  assert.equal(setup.commands[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(setup.commands.at(-1), "ROLLBACK");
});

test("PHASE 3F.6 rejects a wrong article", async () => {
  const setup = fixture();
  setup.state.products[0].articleNormalized = "A0000000000";
  const report = await run(setup);
  assert.ok(report.errors.some((error) => error.startsWith("ARTICLE_MISMATCH:385:")));
  assert.equal(report.candidates.length, 31);
  assert.equal(setup.state.memberships.length, 0);
});

test("PHASE 3F.6 rejects a wrong EPC", async () => {
  const setup = fixture();
  setup.state.products[0].technicalEpcGroups = ["84"];
  const report = await run(setup);
  assert.ok(report.errors.includes("EPC_MISMATCH:385:A2045843782Z122:58"));
  assert.equal(report.candidates.length, 31);
});

test("PHASE 3F.6 rejects missing and inactive allowlisted products", async (t) => {
  await t.test("missing", async () => {
    const setup = fixture();
    setup.state.products = setup.state.products.filter((product) => product.id !== 385);
    const report = await run(setup);
    assert.ok(report.errors.includes("MISSING_PRODUCT:385:A2045843782Z122"));
    assert.equal(report.productsFound, 31);
  });
  await t.test("inactive", async () => {
    const setup = fixture();
    setup.state.products.find((product) => product.id === 385).isActive = false;
    const report = await run(setup);
    assert.ok(report.errors.includes("INACTIVE_PRODUCT:385:A2045843782Z122"));
    assert.equal(report.productsFound, 32);
  });
});

test("PHASE 3F.6 rejects an inactive or non-root accessories target", async () => {
  const setup = fixture();
  setup.state.category.isActive = false;
  setup.state.category.parentId = 20;
  const report = await run(setup);
  assert.ok(report.errors.includes("INVALID_TARGET_CATEGORY:accessories"));
  assert.equal(report.candidates.length, 0);
});

test("PHASE 3F.6 fails if an approved primary appears after dry-run", async () => {
  const setup = fixture();
  const dry = await run(setup);
  assert.deepEqual(dry.errors, []);
  setup.state.memberships.push(membership({
    productId: 385,
    categoryId: 20,
    source: "MANUAL",
    origin: "ADMIN",
    confidence: "HIGH",
    approvalStatus: "MANUAL_APPROVED",
  }));
  const beforeApply = structuredClone(setup.state.memberships);
  await assert.rejects(
    run(setup, {
      mode: "APPLY",
      confirmation: PHASE3F6_ACCESSORIES_CONFIRMATION,
    }),
    (error) => (
      error instanceof CustomerTaxonomyPhase3FAccessoriesBackfillError
      && error.report.errors.includes("APPROVED_PRIMARY_PRESENT:385:engine")
    ),
  );
  assert.deepEqual(setup.state.memberships, beforeApply);
  assert.equal(setup.commands.at(-1), "ROLLBACK");
});

test("PHASE 3F.6 rejects a short allowlist and rolls back", async () => {
  const setup = fixture();
  const shortAllowlist = PHASE3F6_ACCESSORIES_ALLOWLIST.slice(0, 31);
  await assert.rejects(
    run(setup, {
      mode: "APPLY",
      confirmation: PHASE3F6_ACCESSORIES_CONFIRMATION,
      allowlist: shortAllowlist,
    }),
    (error) => (
      error instanceof CustomerTaxonomyPhase3FAccessoriesBackfillError
      && error.report.errors.includes("ALLOWLIST_COUNT:32:31")
    ),
  );
  assert.equal(setup.state.memberships.length, 0);
  assert.equal(setup.commands.at(-1), "ROLLBACK");
});

test("PHASE 3F.6 rejects any global duplicate primary", async () => {
  const setup = fixture();
  setup.state.memberships.push(
    membership({ productId: 999, categoryId: 10 }),
    membership({ productId: 999, categoryId: 20 }),
  );
  const before = structuredClone(setup.state.memberships);
  await assert.rejects(
    run(setup, {
      mode: "APPLY",
      confirmation: PHASE3F6_ACCESSORIES_CONFIRMATION,
    }),
    (error) => (
      error instanceof CustomerTaxonomyPhase3FAccessoriesBackfillError
      && error.report.errors.includes("GLOBAL_DUPLICATE_PRIMARY:1")
    ),
  );
  assert.deepEqual(setup.state.memberships, before);
});

test("PHASE 3F.6 exact APPLY writes only root accessories with BACKFILL provenance", async () => {
  const setup = fixture();
  const report = await run(setup, {
    mode: "APPLY",
    confirmation: PHASE3F6_ACCESSORIES_CONFIRMATION,
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.applied, { safe: 32, total: 32 });
  assert.deepEqual(report.verification, {
    products: 32,
    correctTarget: 32,
    duplicatePrimary: 0,
  });
  assert.equal(setup.state.memberships.length, 32);
  assert.equal(setup.state.memberships.every((item) => (
    item.categorySlug === "accessories"
    && item.parentSlug === null
    && item.isPrimary === true
    && item.assignmentSource === "EPC_FALLBACK"
    && item.assignmentOrigin === "BACKFILL"
    && item.confidence === "MEDIUM"
    && item.approvalStatus === "AUTO_APPROVED"
    && item.ruleCode === null
    && item.ruleVersion === null
  )), true);
  assert.equal(setup.commands.at(-1), "COMMIT");
});

test("PHASE 3F.6 second dry-run and APPLY are idempotent read-only no-ops", async () => {
  const setup = fixture();
  await run(setup, {
    mode: "APPLY",
    confirmation: PHASE3F6_ACCESSORIES_CONFIRMATION,
  });
  const afterFirst = structuredClone(setup.state.memberships);
  const writesAfterFirst = setup.upsertCalls;
  const dry = await run(setup);
  assert.equal(dry.idempotentNoop, true);
  assert.equal(dry.candidates.length, 0);
  assert.equal(dry.alreadyApplied.length, 32);
  const repeatedApply = await run(setup, {
    mode: "APPLY",
    confirmation: PHASE3F6_ACCESSORIES_CONFIRMATION,
  });
  assert.equal(repeatedApply.idempotentNoop, true);
  assert.deepEqual(repeatedApply.applied, { safe: 0, total: 0 });
  assert.equal(setup.upsertCalls, writesAfterFirst);
  assert.deepEqual(setup.state.memberships, afterFirst);
  assert.equal(setup.commands.at(-1), "ROLLBACK");
});

test("PHASE 3F.6 rolls the whole transaction back after a write failure", async () => {
  const setup = fixture({ failUpsertAt: 10 });
  await assert.rejects(
    run(setup, {
      mode: "APPLY",
      confirmation: PHASE3F6_ACCESSORIES_CONFIRMATION,
    }),
    /injected membership write failure/,
  );
  assert.equal(setup.upsertCalls, 10);
  assert.equal(setup.state.memberships.length, 0);
  assert.equal(setup.commands.at(-1), "ROLLBACK");
});
