import test from "node:test";
import assert from "node:assert/strict";

import { CUSTOMER_TAXONOMY_PHASE2G1_REVIEW } from "../data/CustomerTaxonomyPhase2G1Review.js";
import {
  CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
  detectCustomerProductTypes,
} from "./CustomerProductTypeDetector.js";

function reviewed(typeCode) {
  const row = CUSTOMER_TAXONOMY_PHASE2G1_REVIEW.find((item) => (
    item.finalBucket === "HIGH" && item.typeCode === typeCode
  ));
  assert.ok(row, `missing fixture for ${typeCode}`);
  return {
    article: row.article,
    articleNormalized: row.article,
    name: row.name,
    technicalEpcGroups: [row.epc],
  };
}

function assertExactType(typeCode) {
  assert.deepEqual(detectCustomerProductTypes(reviewed(typeCode)), [typeCode]);
}

test("detector v9 preserves reviewed Body/Glass and Interior/Safety semantic types", () => {
  assert.equal(CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION, 9);
  for (const typeCode of [
    "BODY_BUMPER",
    "INTERIOR_TRIM_PANEL",
    "BODY_MIRROR_PART",
    "GLASS_SIDE_WINDOW",
    "BODY_LOCK_LATCH",
    "SAFETY_AIRBAG",
    "INTERIOR_SEAT",
    "INTERIOR_SEAT_MECHANISM",
    "SAFETY_RESTRAINT_COMPONENT",
  ]) assertExactType(typeCode);
});

test("generic and electrical Body/Interior audit rows do not become passive narrow leaves", () => {
  for (const article of [
    "A0008683330", // generic trim
    "A2107201146", // electric window-regulator drive
    "A2117300446", // electric window-regulator drive
    "A20268012363400", // electrical control panel
  ]) {
    const row = CUSTOMER_TAXONOMY_PHASE2G1_REVIEW.find((item) => item.article === article);
    assert.ok(row);
    assert.deepEqual(detectCustomerProductTypes({
      article: row.article,
      articleNormalized: row.article,
      name: row.name,
      technicalEpcGroups: [row.epc],
    }), []);
  }
});

test("unreviewed mirror motors, steering locks and airbag modules are not passive PHASE 2G.1 types", () => {
  const cases = [
    { article: "A9998100001", name: "Мотор наружного зеркала", epc: "81" },
    { article: "A9994600001", name: "Замок рулевого вала", epc: "46" },
    { article: "A9998600001", name: "Блок управления подушкой безопасности", epc: "86" },
  ];
  for (const item of cases) {
    const types = detectCustomerProductTypes({
      article: item.article,
      articleNormalized: item.article,
      name: item.name,
      technicalEpcGroups: [item.epc],
    });
    assert.equal(types.some((type) => type.startsWith("BODY_")), false);
    assert.equal(types.includes("GLASS_SIDE_WINDOW"), false);
    assert.equal(types.includes("SAFETY_AIRBAG"), false);
  }
});

test("existing Accessories and Climate reviewed semantics remain available in detector v9", () => {
  assert.ok(detectCustomerProductTypes({
    article: "B9996800001",
    name: "Комплект ковриков салона",
    technicalEpcGroups: [],
  }).includes("ACCESSORY_FLOOR_MAT"));
  assert.ok(detectCustomerProductTypes({
    article: "A9998300001",
    name: "Дефлектор вентиляції салону",
    technicalEpcGroups: ["83"],
  }).includes("HVAC_AIR_DUCT_VENT"));
});
