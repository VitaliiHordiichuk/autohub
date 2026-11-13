import assert from "node:assert/strict";
import test from "node:test";

import { detectCustomerProductTypes } from "./CustomerProductTypeDetector.js";
import { resolveCustomerTaxonomy } from "./CustomerTaxonomyResolver.js";
import { CustomerTaxonomyImportService } from "./CustomerTaxonomyImportService.js";

const examples = [
  ["A2976709601", "Скло лобове", "GLASS_WINDSHIELD"],
  ["A2946700400", "Лобовое стекло", "GLASS_WINDSHIELD"],
  ["A2966701300", "Front windshield", "GLASS_WINDSHIELD"],
  ["A1679068510", "Фара головного світла", "LIGHTING_HEADLIGHT"],
  ["A1669068701", "Задній ліхтар", "LIGHTING_REAR_LAMP"],
  ["A167885030764", "Накладка бампера", "BODY_EXTERIOR_TRIM"],
  ["A2214700659", "Повітряний фільтр двигуна", "FILTER_AIR_ENGINE"],
];

test("explicit UK/RU/EN part semantics and EPC context recognize the reported examples", () => {
  for (const [article, name, expected] of examples) {
    const epc = article.slice(4, 6);
    assert.ok(detectCustomerProductTypes({
      article, name, technicalEpcGroups: [epc],
    }).includes(expected), article);
  }
});

test("broad EPC and related components do not masquerade as complete parts", () => {
  for (const [article, name] of [
    ["A2976709601", "Ущільнювач лобового скла"],
    ["A1679068510", "Блок керування фарою"],
    ["A1669068701", "Лампочка заднього ліхтаря"],
    ["A167885030764", "Кронштейн накладки бампера"],
    ["A2214700659", "Корпус повітряного фільтра двигуна"],
  ]) {
    const epc = article.slice(4, 6);
    const detected = detectCustomerProductTypes({ article, name, technicalEpcGroups: [epc] });
    assert.equal(detected.includes("GLASS_WINDSHIELD"), false, name);
    assert.equal(detected.includes("LIGHTING_HEADLIGHT"), false, name);
    assert.equal(detected.includes("LIGHTING_REAR_LAMP"), false, name);
    assert.equal(detected.includes("BODY_EXTERIOR_TRIM"), false, name);
    assert.equal(detected.includes("FILTER_AIR_ENGINE"), false, name);
  }
});

test("headlight seals and gaskets do not become complete headlights", () => {
  for (const [article, name] of [
    ["A1678260200", "Прокладка ущільнююча фари"],
    ["A1668260500", "Прокладка ущільнююча фари"],
    ["A0008260600", "Ущільнювач фари"],
    ["A1668262191", "Ущільнювач фари"],
    ["A204826009164", "Ущільнювач фари"],
  ]) {
    const detected = detectCustomerProductTypes({
      article,
      name,
      translations: [{ name: "Headlamp seal" }],
      technicalEpcGroups: ["82"],
    });
    assert.equal(detected.includes("LIGHTING_HEADLIGHT"), false, article);
  }
});

test("decorative door trim remains review; explicit owner-approved NOx semantics are detected", () => {
  for (const [article, name] of [
    ["A2226982201", "Декоративна накладка дверей"],
    ["A0009053119", "Датчик NOx"],
  ]) {
    const resolution = resolveCustomerTaxonomy({
      product: { article, name, technicalEpcGroups: [article.slice(4, 6)] },
      rules: [],
    });
    assert.deepEqual(resolution.typeCodes, article === "A0009053119" ? ["EXHAUST_SENSOR"] : [], article);
    assert.equal(resolution.proposals.length, 0, article);
  }
});

test("REAL_REVIEW blocks even a newly matching automatic proposal", async () => {
  for (const article of ["A2226982201", "A0009053119"]) {
    const evaluation = await CustomerTaxonomyImportService.evaluateProduct({
      product: {
        id: 1,
        article,
        name: "Деталь",
        technicalEpcGroups: [article.slice(4, 6)],
      },
      existingMemberships: [],
      context: { rules: [] },
    }, {
      db: {},
      resolver: () => ({
        numberFamily: "A",
        typeCodes: [],
        conflicts: [],
        proposals: [{
          category: { id: 1, slug: "wrong-leaf", parentSlug: "body-glass" },
          isPrimary: true,
          approvalStatus: "AUTO_APPROVED",
        }],
      }),
    });
    assert.equal(evaluation.disposition.requiresReview, true, article);
    assert.equal(evaluation.candidate, null, article);
    assert.deepEqual(evaluation.proposals, [], article);
  }
});

test("component and conflicting leaf names never become automatic primaries", async () => {
  const cases = [
    ["A1635460443", "Держатель проводки торм. датч", "brakes-sensors", "SENSOR_HOLDER_NOT_SENSOR"],
    ["A2234630000", "Пильник тяги", "steering-tie-rods", "TIE_ROD_BOOT_NOT_ROD"],
    ["A000490214164", "Хомут", "exhaust-mounts", "GENERIC_CLAMP_WITH_EPC_ONLY"],
    ["A167885030764", "Накладка бампера", "body-mouldings-trims", "BUMPER_TRIM_CATEGORY_CONFLICT"],
  ];
  for (const [article, name, slug, reason] of cases) {
    const evaluation = await CustomerTaxonomyImportService.evaluateProduct({
      product: { id: 1, article, name, technicalEpcGroups: [article.slice(4, 6)] },
      existingMemberships: [], context: { rules: [] },
    }, {
      db: {}, assignmentOrigin: "IMPORT",
      resolver: () => ({
        numberFamily: "A", typeCodes: [], conflicts: [], proposals: [{
          category: { id: 1, slug, parentSlug: "test-root" },
          isPrimary: true, approvalStatus: "AUTO_APPROVED", assignmentSource: "RULE",
          confidence: "HIGH", ruleCode: "TEST_RULE", ruleVersion: 1,
        }],
      }),
    });
    assert.equal(evaluation.disposition.reason, reason, article);
    assert.equal(evaluation.disposition.requiresReview, true, article);
    assert.equal(evaluation.candidate, null, article);
  }
});
