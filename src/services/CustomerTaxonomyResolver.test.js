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
  assert.equal(CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION, 6);
  assert.equal(isKnownCustomerProductTypeCode("FILTER_OIL"), true);
  assert.equal(isKnownCustomerProductTypeCode("arbitrary words"), false);
  assert.deepEqual(detectCustomerProductTypes(product()), ["FILTER_OIL"]);
});

test("steering types require reviewed steering EPC and semantic context", () => {
  assert.ok(detectCustomerProductTypes(product({
    name: "Рейка кермова",
    technicalEpcGroups: ["46"],
  })).includes("STEERING_RACK"));
  assert.ok(detectCustomerProductTypes(product({
    name: "Тяга рульова",
    technicalEpcGroups: ["33"],
  })).includes("STEERING_TIE_ROD"));
  assert.ok(detectCustomerProductTypes(product({
    name: "Наконечник керма",
    technicalEpcGroups: ["33"],
  })).includes("STEERING_TIE_ROD_END"));
  assert.equal(detectCustomerProductTypes(product({
    name: "Тяга стабілізатора",
    technicalEpcGroups: ["32"],
  })).some((code) => code.startsWith("STEERING_")), false);
  assert.equal(detectCustomerProductTypes(product({
    name: "Насос охолоджувальної рідини",
    technicalEpcGroups: ["20"],
  })).includes("STEERING_PUMP"), false);
});

test("exhaust detector separates complete parts from generic sensors and pipes", () => {
  assert.ok(detectCustomerProductTypes(product({
    name: "Каталізатор випускної системи",
    technicalEpcGroups: ["14"],
  })).includes("EXHAUST_CATALYST"));
  assert.ok(detectCustomerProductTypes(product({
    name: "Глушитель",
    technicalEpcGroups: ["49"],
  })).includes("EXHAUST_MUFFLER"));
  assert.ok(detectCustomerProductTypes(product({
    name: "Труба глушника",
    technicalEpcGroups: ["49"],
  })).includes("EXHAUST_PIPE"));
  assert.ok(detectCustomerProductTypes(product({
    name: "Датчик тиску вихлопних газів",
    technicalEpcGroups: ["90"],
  })).includes("EXHAUST_SENSOR"));
  assert.equal(detectCustomerProductTypes(product({
    name: "Датчик тиску оливи",
    technicalEpcGroups: ["18"],
  })).includes("EXHAUST_SENSOR"), false);
  assert.equal(detectCustomerProductTypes(product({
    name: "Трубка паливна",
    technicalEpcGroups: ["47"],
  })).includes("EXHAUST_PIPE"), false);
  assert.equal(detectCustomerProductTypes(product({
    name: "Прокладка глушника",
    technicalEpcGroups: ["49"],
  })).includes("EXHAUST_MUFFLER"), false);
});

test("wheel detector distinguishes rims, caps, fasteners and TPMS", () => {
  assert.ok(detectCustomerProductTypes(product({
    name: "Диск колісний легкосплавний",
    technicalEpcGroups: ["40"],
  })).includes("WHEEL_RIM"));
  assert.equal(detectCustomerProductTypes(product({
    name: "Диск гальмівний",
    technicalEpcGroups: ["42"],
  })).includes("WHEEL_RIM"), false);
  assert.ok(detectCustomerProductTypes(product({
    name: "Ковпак колеса",
    technicalEpcGroups: ["40"],
  })).includes("WHEEL_CENTER_CAP"));
  assert.ok(detectCustomerProductTypes(product({
    name: "Болти колісні",
    technicalEpcGroups: ["99"],
  })).includes("WHEEL_BOLT_NUT"));
  assert.ok(detectCustomerProductTypes(product({
    name: "Датчик тиску в шині",
    technicalEpcGroups: ["90"],
  })).includes("TPMS_SENSOR"));
  assert.equal(detectCustomerProductTypes(product({
    name: "Датчик тиску палива",
    technicalEpcGroups: ["90"],
  })).includes("TPMS_SENSOR"), false);
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
  assert.deepEqual(detectCustomerProductTypes(product({
    article: "A212470065905",
    name: "AKTIVKOHLEFILTER",
    technicalEpcGroups: ["47"],
  })), ["FUEL_VAPOR_CANISTER"]);
  assert.deepEqual(detectCustomerProductTypes(product({
    article: "A2214700759",
    name: "AKTKOHLEFILTER",
    technicalEpcGroups: ["47"],
  })), ["FUEL_VAPOR_CANISTER"]);
  assert.deepEqual(detectCustomerProductTypes(product({
    name: "Charcoal canister",
    technicalEpcGroups: ["47"],
  })), ["FUEL_VAPOR_CANISTER"]);
  assert.deepEqual(detectCustomerProductTypes(product({
    name: "Kraftstoffverdunstungsanlage",
    technicalEpcGroups: ["47"],
  })), ["FUEL_VAPOR_CANISTER"]);
  assert.deepEqual(detectCustomerProductTypes(product({
    name: "Адсорбер паров топлива",
    technicalEpcGroups: ["47"],
  })), ["FUEL_VAPOR_CANISTER"]);
  for (const name of [
    "Фільтр з активним вугіллям",
    "Фильтр с активированным углем",
    "Угольный фильтр",
    "Вугільний фільтр",
    "Charcoal filter",
    "Activated carbon filter",
  ]) {
    const types = detectCustomerProductTypes(product({
      article: "A212470065905",
      name,
      technicalEpcGroups: ["47"],
    }));
    assert.equal(types.includes("FUEL_VAPOR_CANISTER"), true, name);
    assert.equal(types.includes("FILTER_FUEL"), false, name);
  }
  assert.deepEqual(detectCustomerProductTypes(product({
    article: "A0024776101",
    name: "Фільтр паливний",
    technicalEpcGroups: ["47"],
  })), ["FILTER_FUEL"]);
  assert.deepEqual(detectCustomerProductTypes(product({
    name: "Activated charcoal filter",
    technicalEpcGroups: ["83"],
  })), ["FILTER_CABIN"]);
  assert.equal(detectCustomerProductTypes(product({
    name: "Рамка повітряного фільтра",
    technicalEpcGroups: ["09"],
  })).includes("FILTER_AIR_ENGINE"), false);
  assert.equal(detectCustomerProductTypes(product({
    name: "Комплект фільтрів (паливний + масляний + повітряний)",
    technicalEpcGroups: ["83"],
  })).some((code) => code.startsWith("FILTER_")), false);
});

test("explicit filter semantics take precedence over broad EPC fallback", () => {
  assert.deepEqual(detectCustomerProductTypes(product({
    name: "Фільтр повітряний двигуна",
    technicalEpcGroups: ["83"],
  })), ["FILTER_AIR_ENGINE"]);
  assert.deepEqual(detectCustomerProductTypes(product({
    name: "Фільтр паливний",
    technicalEpcGroups: ["47"],
  })), ["FILTER_FUEL"]);
  assert.deepEqual(detectCustomerProductTypes(product({
    name: "Фільтр повітряний салону вугільний",
    technicalEpcGroups: ["83"],
  })), ["FILTER_CABIN"]);
});

test("brake component names do not become complete discs or calipers", () => {
  assert.equal(detectCustomerProductTypes(product({
    name: "Щиток захисту гальмівного диску",
    technicalEpcGroups: ["42"],
  })).includes("BRAKE_DISC"), false);
  assert.equal(detectCustomerProductTypes(product({
    name: "Направляюча супорта, комплект",
    technicalEpcGroups: ["42"],
  })).includes("BRAKE_CALIPER"), false);
  assert.equal(detectCustomerProductTypes(product({
    name: "Супорт гальмівний",
    technicalEpcGroups: ["42"],
  })).includes("BRAKE_CALIPER"), true);
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

test("PHASE 2E semantic types require reviewed EPC context", () => {
  assert.ok(detectCustomerProductTypes(product({
    article: "A0004700400",
    name: "Насос AdBlue",
    technicalEpcGroups: ["47"],
  })).includes("ADBLUE_SCR_COMPONENT"));
  assert.ok(detectCustomerProductTypes(product({
    article: "A6540703203",
    name: "Насос паливний високого тиску",
    technicalEpcGroups: ["07"],
  })).includes("FUEL_PUMP"));
  assert.ok(detectCustomerProductTypes(product({
    article: "A1772003400",
    name: "Натягувач ременя",
    technicalEpcGroups: ["20"],
  })).includes("ENGINE_BELT_DRIVE_COMPONENT"));
  assert.equal(detectCustomerProductTypes(product({
    article: "A1772003400",
    name: "Натягувач ременя",
    technicalEpcGroups: ["20"],
  })).some((code) => code.startsWith("COOLING_")), false);
  assert.ok(detectCustomerProductTypes(product({
    article: "A0005000801",
    name: "Насос системи охолодження",
    technicalEpcGroups: ["50"],
  })).includes("COOLING_WATER_PUMP"));
  assert.ok(detectCustomerProductTypes(product({
    article: "A2215000754",
    name: "Конденсатор кондиціонера",
    technicalEpcGroups: ["50"],
  })).includes("AC_CONDENSER"));
  assert.ok(detectCustomerProductTypes(product({
    article: "A0995005903",
    name: "Радіатор системи охолодження",
    technicalEpcGroups: ["50"],
  })).includes("COOLING_RADIATOR"));
  assert.ok(detectCustomerProductTypes(product({
    article: "A1668307401",
    name: "Комплект фільтрів повітря салону",
    technicalEpcGroups: ["83"],
  })).includes("FILTER_CABIN_KIT"));
  assert.equal(detectCustomerProductTypes(product({
    article: "A0008309999",
    name: "Датчик",
    technicalEpcGroups: ["83"],
  })).includes("HVAC_TEMPERATURE_SENSOR"), false);
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
      rule({
        code: "FUTURE",
        detectorVersion: CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION + 1,
      }),
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
