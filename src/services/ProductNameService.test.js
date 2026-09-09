import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeProductName,
  publicProductName,
} from "./ProductNameService.js";

test("очищает технический мусор в названии, не обрезая текст", () => {
  assert.equal(normalizeProductName("  .Парасоля   з логотипом  "), "Парасоля з логотипом");
  assert.equal(normalizeProductName("Кришка // корпус"), "Кришка / корпус");
  assert.equal(normalizeProductName("КЛИП//"), "Клип");
  assert.equal(normalizeProductName("РЕШЕТКА В СБОРЕ Б/У//////////////////"), "Решетка в сборе б/у");
  assert.equal(normalizeProductName("# БЛОК  УПРАВЛЕНИЯ"), "Блок управления");
  assert.equal(normalizeProductName("Маточина колеса..."), "Маточина колеса");
  assert.equal(normalizeProductName("Модель машини 1:18, металева,"), "Модель машини 1:18, металева");
  assert.equal(normalizeProductName("Парасоля з логотипом Mercedes-"), "Парасоля з логотипом Mercedes");
});

test("осторожно приводит сплошной верхний регистр к читаемому виду", () => {
  assert.equal(normalizeProductName("ГАЛЬМІВНИЙ КЛАПАН ABS"), "Гальмівний клапан ABS");
  assert.equal(normalizeProductName("ДАТЧИК A2059053414"), "Датчик A2059053414");
  assert.equal(normalizeProductName("АКСЕССУАР MERCEDES-BENZ OEM"), "Аксессуар Mercedes-Benz OEM");
});

test("ручное название имеет безусловный приоритет и не нормализуется", () => {
  assert.equal(publicProductName("Авторское НАЗВАНИЕ // детали", "MANUAL"), "Авторское НАЗВАНИЕ // детали");
});
