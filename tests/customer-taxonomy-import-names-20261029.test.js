import test from "node:test";
import assert from "node:assert/strict";
import {
  detectCustomerProductTypes
} from "../src/services/CustomerProductTypeDetector.js";

const cases = [
  // EPC 99 and a generic word alone do not justify a narrow unreviewed leaf.
  ["Хомут", "99", "FASTENER_CLAMP", false],
  ["Schlauchschelle", "99", "FASTENER_CLAMP", false],
  ["Фара головного світла", "90", "LIGHTING_HEADLIGHT", true],
  ["Hauptscheinwerfer", "90", "LIGHTING_HEADLIGHT", true],
  ["Гасос ГУР", "46", "STEERING_PUMP", true],
  ["Насос гідропідсилювача", "46", "STEERING_PUMP", true],
  ["Хомут вихлопної системи", "49", "FASTENER_CLAMP", false],
  ["Кронштейн фари головного світла", "90", "LIGHTING_HEADLIGHT", false],
  ["Хомут", "40", "FASTENER_CLAMP", false],
];

for (const [name, epc, code, expected] of cases) {
  test(`${name} / EPC ${epc}`, () => {
    const types = detectCustomerProductTypes({
      article: "A9999991234",
      name,
      technicalEpcGroups: [epc]
    });

    assert.equal(types.includes(code), expected);
  });
}
