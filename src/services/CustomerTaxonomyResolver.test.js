import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
  detectCustomerProductTypes,
  isKnownCustomerProductTypeCode,
} from "./CustomerProductTypeDetector.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  CUSTOMER_ASSIGNMENT_ORIGIN,
  resolveCustomerTaxonomy,
} from "./CustomerTaxonomyResolver.js";

function rule(overrides = {}) {
  return {
    id: 1,
    code: "FILTER_OIL_V1",
    version: 1,
    detectorVersion: CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
    sourceKind: "RULE",
    assignmentRole: "PRIMARY",
    numberFamily: null,
    epcGroup: null,
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
    ...overrides,
  };
}

function product(overrides = {}) {
  return {
    article: "A0001800109",
    articleNormalized: "A0001800109",
    name: "Масляний фільтр",
    technicalEpcGroups: ["18"],
    ...overrides,
  };
}

test("TYPE_CODE contract is closed and detector version is fixed", () => {
  assert.equal(CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION, 1);
  assert.equal(isKnownCustomerProductTypeCode("FILTER_OIL"), true);
  assert.equal(isKnownCustomerProductTypeCode("arbitrary words"), false);
  assert.deepEqual(detectCustomerProductTypes(product()), ["FILTER_OIL"]);
});

test("detector reproduces reviewed filter semantics with mixed-script names and EPC context", () => {
  assert.deepEqual(detectCustomerProductTypes(product({
    name: "Фiльтр мастила",
  })), ["FILTER_OIL"]);
  assert.deepEqual(detectCustomerProductTypes(product({
    name: "Фільтр",
    technicalEpcGroups: ["83"],
  })), ["FILTER_CABIN"]);
  assert.equal(detectCustomerProductTypes(product({
    name: "Кришка фільтра мастила",
  })).includes("FILTER_OIL"), false);
});

test("detector separates service belts, tensioners and wiper blades from mechanisms", () => {
  assert.deepEqual(
    detectCustomerProductTypes(product({ name: "Ремінь привідний" })),
    ["SERVICE_BELT"],
  );
  assert.deepEqual(
    detectCustomerProductTypes(product({ name: "Натягувач ременя" })),
    ["BELT_TENSIONER"],
  );
  assert.equal(
    detectCustomerProductTypes(product({ name: "Щітка склоочисника" }))
      .includes("WIPER_BLADE"),
    true,
  );
  assert.equal(
    detectCustomerProductTypes(product({ name: "Механізм склоочисника" }))
      .includes("WIPER_BLADE"),
    false,
  );
});

test("ignition detector does not confuse license-plate illumination with a spark plug", () => {
  assert.equal(
    detectCustomerProductTypes(product({
      name: "Плафон підсвічування номерного знака",
      technicalEpcGroups: ["90"],
    })).includes("IGNITION_SPARK_PLUG"),
    false,
  );
});

test("HIGH RULE auto-approves only when explicitly allowed", () => {
  const approved = resolveCustomerTaxonomy({ product: product(), rules: [rule()] });
  assert.equal(approved.proposals[0].approvalStatus, "AUTO_APPROVED");
  assert.equal(approved.proposals[0].isPrimary, true);

  const review = resolveCustomerTaxonomy({
    product: product(),
    rules: [rule({ autoApprovalAllowed: false })],
  });
  assert.equal(review.proposals[0].approvalStatus, "REVIEW");
  assert.equal(review.proposals[0].isPrimary, false);
});

test("HIGH EPC_FALLBACK auto-approves only when explicitly allowed", () => {
  const resolution = resolveCustomerTaxonomy({
    product: product(),
    rules: [rule({
      code: "EPC_18",
      sourceKind: "EPC_FALLBACK",
      matchType: "EPC_ONLY",
      matchValue: null,
      epcGroup: "18",
    })],
  });
  assert.equal(resolution.proposals[0].assignmentSource, "EPC_FALLBACK");
  assert.equal(resolution.proposals[0].approvalStatus, "AUTO_APPROVED");
  assert.equal(resolution.proposals[0].isPrimary, true);
});

for (const confidence of ["MEDIUM", "LOW"]) {
  test(`${confidence} is REVIEW even if a malformed input says auto approval is allowed`, () => {
    const resolution = resolveCustomerTaxonomy({
      product: product(),
      rules: [rule({ confidence, autoApprovalAllowed: true })],
    });
    assert.equal(resolution.proposals[0].approvalStatus, "REVIEW");
    assert.equal(resolution.proposals[0].isPrimary, false);
  });
}

test("MANUAL primary is preserved ahead of RULE and EPC_FALLBACK", () => {
  const resolution = resolveCustomerTaxonomy({
    product: product(),
    rules: [
      rule(),
      rule({
        id: 2,
        code: "EPC_18",
        sourceKind: "EPC_FALLBACK",
        matchType: "EPC_ONLY",
        matchValue: null,
        epcGroup: "18",
        targetCategoryId: 200,
      }),
    ],
    existingMemberships: [{
      assignmentSource: "MANUAL",
      approvalStatus: "MANUAL_APPROVED",
      isPrimary: true,
      customerCategoryId: 999,
    }],
  });
  assert.equal(resolution.manualPrimaryPreserved, true);
  assert.equal(resolution.proposals.length, 0);
});

test("RULE outranks EPC_FALLBACK", () => {
  const resolution = resolveCustomerTaxonomy({
    product: product(),
    rules: [
      rule({ priority: 900 }),
      rule({
        id: 2,
        code: "EPC_18",
        sourceKind: "EPC_FALLBACK",
        matchType: "EPC_ONLY",
        matchValue: null,
        epcGroup: "18",
        targetCategoryId: 200,
        priority: 1,
      }),
    ],
  });
  assert.equal(resolution.proposals[0].category.id, 101);
  assert.equal(resolution.proposals[0].assignmentSource, "RULE");
});

test("specificity is ARTICLE_EXACT > ARTICLE_PREFIX > EPC+TYPE > TYPE > EPC_ONLY", () => {
  const rules = [
    rule({ id: 1, code: "TYPE", targetCategoryId: 1 }),
    rule({
      id: 2,
      code: "EPC_TYPE",
      targetCategoryId: 2,
      epcGroup: "18",
    }),
    rule({
      id: 3,
      code: "PREFIX",
      targetCategoryId: 3,
      matchType: "ARTICLE_PREFIX",
      matchValue: "A00018",
    }),
    rule({
      id: 4,
      code: "EXACT",
      targetCategoryId: 4,
      matchType: "ARTICLE_EXACT",
      matchValue: "A0001800109",
    }),
  ];
  const resolution = resolveCustomerTaxonomy({ product: product(), rules });
  assert.equal(resolution.proposals[0].category.id, 4);
});

test("equal-strength different primary targets become REVIEW conflict", () => {
  const resolution = resolveCustomerTaxonomy({
    product: product(),
    rules: [
      rule({ id: 1, code: "OIL_A", targetCategoryId: 101 }),
      rule({ id: 2, code: "OIL_B", targetCategoryId: 102 }),
    ],
  });
  assert.equal(resolution.conflicts.length, 1);
  assert.equal(resolution.proposals.length, 2);
  assert.ok(resolution.proposals.every((item) => (
    item.approvalStatus === CUSTOMER_APPROVAL_STATUS.REVIEW
    && item.isPrimary === false
  )));
});

test("disabled rule is ignored", () => {
  const resolution = resolveCustomerTaxonomy({
    product: product(),
    rules: [rule({ isActive: false })],
  });
  assert.equal(resolution.unclassified, true);
  assert.equal(resolution.proposals.length, 0);
});

test("unknown TYPE_CODE and unsupported detector version are ignored safely", () => {
  const resolution = resolveCustomerTaxonomy({
    product: product(),
    rules: [
      rule({ code: "UNKNOWN", matchValue: "FREE FORM REGEX" }),
      rule({ code: "FUTURE", detectorVersion: 2 }),
    ],
  });
  assert.equal(resolution.unclassified, true);
  assert.deepEqual(
    resolution.diagnostics.map((item) => item.reason),
    ["UNKNOWN_TYPE_CODE", "UNSUPPORTED_DETECTOR_VERSION"],
  );
});

test("assignment source and assignment origin remain independent", () => {
  const resolution = resolveCustomerTaxonomy({
    product: product(),
    rules: [rule()],
    assignmentOrigin: CUSTOMER_ASSIGNMENT_ORIGIN.IMPORT,
  });
  assert.equal(resolution.proposals[0].assignmentSource, "RULE");
  assert.equal(resolution.proposals[0].assignmentOrigin, "IMPORT");
});

test("secondary rule never replaces the primary path", () => {
  const resolution = resolveCustomerTaxonomy({
    product: product(),
    rules: [
      rule(),
      rule({
        id: 2,
        code: "OIL_SECONDARY",
        assignmentRole: "SECONDARY",
        targetCategoryId: 201,
      }),
    ],
  });
  const primary = resolution.proposals.find((item) => item.assignmentRole === "PRIMARY");
  const secondary = resolution.proposals.find((item) => item.assignmentRole === "SECONDARY");
  assert.equal(primary.isPrimary, true);
  assert.equal(secondary.isPrimary, false);
});
