import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeProductName,
  publicProductName,
} from "./ProductNameService.js";

test("очищает технический мусор в названии, не обрезая текст", () => {
  assert.equal(normalizeProductName("  .Парасоля   з логотипом  "), "Парасоля з логотипом");
  assert.equal(normalizeProductName("Кришка // корпус"), "Кришка / корпус");
});

test("осторожно приводит сплошной верхний регистр к читаемому виду", () => {
  assert.equal(normalizeProductName("ГАЛЬМІВНИЙ КЛАПАН ABS"), "Гальмівний клапан ABS");
  assert.equal(normalizeProductName("ДАТЧИК A2059053414"), "Датчик A2059053414");
});

test("ручное название имеет безусловный приоритет и не нормализуется", () => {
  assert.equal(publicProductName("Авторское НАЗВАНИЕ // детали", "MANUAL"), "Авторское НАЗВАНИЕ // детали");
});
