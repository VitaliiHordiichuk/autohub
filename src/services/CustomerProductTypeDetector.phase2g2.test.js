import test from "node:test";
import assert from "node:assert/strict";

import { CUSTOMER_TAXONOMY_PHASE2G2_REVIEW } from "../data/CustomerTaxonomyPhase2G2Review.js";
import {
  CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
  detectCustomerProductTypes,
} from "./CustomerProductTypeDetector.js";

const phase2G2TypeCodes = Object.freeze([
  "ELECTRICAL_CONTROL_UNIT",
  "ELECTRICAL_WIRING_HARNESS",
  "LIGHTING_HEADLIGHT",
  "ELECTRICAL_CONNECTOR",
  "ELECTRICAL_SENSOR",
  "ELECTRICAL_FUSE_BOX",
  "ELECTRICAL_SWITCH",
  "ELECTRICAL_BATTERY",
  "ELECTRICAL_CAMERA",
  "ELECTRICAL_PARKING_SENSOR",
  "ELECTRICAL_RELAY",
  "ELECTRICAL_ALTERNATOR",
  "ELECTRICAL_ANTENNA",
  "ELECTRICAL_FUSE",
  "LIGHTING_FOG_LIGHT",
  "ELECTRICAL_DRIVER_ASSISTANCE",
  "ELECTRICAL_STARTER",
  "ELECTRICAL_INFOTAINMENT",
  "LIGHTING_BULB",
]);

function productFor(row) {
  return {
    article: row.article,
    articleNormalized: row.article,
    name: row.name,
    technicalEpcGroups: row.epc ? [row.epc] : [],
  };
}

function reviewedArticle(article) {
  const row = CUSTOMER_TAXONOMY_PHASE2G2_REVIEW.find((item) => item.article === article);
  assert.ok(row, `missing PHASE 2G.2 audit fixture for ${article}`);
  return row;
}

function reviewedType(typeCode) {
  const row = CUSTOMER_TAXONOMY_PHASE2G2_REVIEW.find((item) => (
    item.finalBucket === "HIGH" && item.typeCode === typeCode
  ));
  assert.ok(row, `missing PHASE 2G.2 HIGH fixture for ${typeCode}`);
  return row;
}

test("detector v10 preserves the 19 reviewed Electrical semantic types", () => {
  assert.equal(CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION, 10);
  for (const typeCode of phase2G2TypeCodes) {
    assert.deepEqual(
      detectCustomerProductTypes(productFor(reviewedType(typeCode))),
      [typeCode],
    );
  }
});

test("PHASE 2G.2 SAFE and REVIEW decisions stay out of narrow Electrical leaves", () => {
  for (const article of [
    "A0005402605",
    "A0031534928",
    "A0034464010",
    "A1644400101",
    "910146000000",
  ]) {
    const types = detectCustomerProductTypes(productFor(reviewedArticle(article)));
    assert.equal(types.some((typeCode) => phase2G2TypeCodes.includes(typeCode)), false);
  }
});

test("existing Wheels and Exhaust semantics are preserved instead of becoming Electrical sensors", () => {
  const expected = [
    ["A000905003064", "TPMS_SENSOR"],
    ["A0009053505", "EXHAUST_SENSOR"],
    ["A099905790064", "EXHAUST_SENSOR"],
  ];
  for (const [article, expectedType] of expected) {
    const types = detectCustomerProductTypes(productFor(reviewedArticle(article)));
    assert.ok(types.includes(expectedType), `${article} must preserve ${expectedType}`);
    assert.equal(types.includes("ELECTRICAL_SENSOR"), false);
  }
});

test("Engine, Fuel, Climate and Brakes keep functional semantic types", () => {
  const cases = [
    {
      article: "A2710940248",
      name: "Витратомiр повiтря",
      technicalEpcGroups: ["09"],
      expected: "ENGINE_SENSOR",
    },
    {
      article: "A271078112380",
      name: "Форсунка паливна",
      technicalEpcGroups: ["07"],
      expected: "FUEL_INJECTOR",
    },
    {
      article: "A2208300772",
      name: "Датчик температури випаровувал",
      technicalEpcGroups: ["83"],
      expected: "HVAC_TEMPERATURE_SENSOR",
    },
    {
      article: "A9994200001",
      name: "Датчик зносу гальмівних колодок",
      technicalEpcGroups: ["42"],
      expected: "BRAKE_SENSOR",
    },
  ];
  for (const item of cases) {
    const types = detectCustomerProductTypes(item);
    assert.ok(types.includes(item.expected), `${item.article} must preserve ${item.expected}`);
    assert.equal(types.some((typeCode) => phase2G2TypeCodes.includes(typeCode)), false);
  }
});

test("Electrical leaf boundaries distinguish assemblies and evidence", () => {
  for (const typeCode of [
    "ELECTRICAL_FUSE",
    "ELECTRICAL_FUSE_BOX",
    "ELECTRICAL_RELAY",
    "ELECTRICAL_CAMERA",
    "ELECTRICAL_DRIVER_ASSISTANCE",
    "LIGHTING_HEADLIGHT",
    "LIGHTING_FOG_LIGHT",
    "LIGHTING_BULB",
  ]) {
    assert.deepEqual(
      detectCustomerProductTypes(productFor(reviewedType(typeCode))),
      [typeCode],
    );
  }
});

test("mirror electronics do not fall into passive Body leaves", () => {
  const types = detectCustomerProductTypes(productFor(reviewedArticle("A9438200097")));
  assert.deepEqual(types, ["ELECTRICAL_SWITCH"]);
  assert.equal(types.some((typeCode) => typeCode.startsWith("BODY_")), false);
});

test("unreviewed generic electrical words do not create PHASE 2G.2 narrow types", () => {
  for (const product of [
    { article: "A9999000001", name: "Датчик", technicalEpcGroups: ["90"] },
    { article: "A9999000002", name: "Модуль", technicalEpcGroups: ["90"] },
    { article: "A9999000003", name: "Лампа", technicalEpcGroups: [] },
    { article: "A9999000004", name: "Мотор дзеркала", technicalEpcGroups: ["88"] },
  ]) {
    const types = detectCustomerProductTypes(product);
    assert.equal(types.some((typeCode) => phase2G2TypeCodes.includes(typeCode)), false);
    assert.equal(types.some((typeCode) => typeCode.startsWith("BODY_")), false);
  }
});
