import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
  detectCustomerProductTypes,
} from "./CustomerProductTypeDetector.js";

function detect({ article = "A2036703401", name, epc = "67", translations = [] }) {
  return detectCustomerProductTypes({
    article,
    articleNormalized: article,
    name,
    translations,
    technicalEpcGroups: [epc],
  });
}

test("detector v10 recognizes verified windshield semantics in EPC 67", () => {
  assert.equal(CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION, 10);
  for (const name of [
    "Скло лобове",
    "Вітрове скло",
    "Лобовое стекло",
    "Ветровое стекло",
    "Windshield",
    "Windscreen",
    "WINDSCHUTZSCHEIBE",
    "WINDSCH.SCHEIBE",
  ]) {
    assert.deepEqual(detect({ name }), ["GLASS_WINDSHIELD"], name);
  }
});

test("windshield detector can use a verified localized translation", () => {
  assert.deepEqual(detect({
    name: "WINDSCH.SCHEIBE",
    translations: [
      { languageCode: "uk", name: "Вітрове скло" },
      { languageCode: "en", name: "Windscreen" },
    ],
  }), ["GLASS_WINDSHIELD"]);
});

test("windshield detector rejects other glass and related parts", () => {
  for (const name of [
    "Скло",
    "Скло бокове",
    "Заднє скло",
    "Панорамне скло",
    "Ущільнювач лобового скла",
    "Windscreen seal",
    "Windscreen support",
    "Windscreen protector",
    "Windscreen wiper blade",
    "Windscreen washer pump",
    "Датчик лобового скла",
    "Молдинг лобового стекла",
  ]) {
    assert.equal(detect({ name }).includes("GLASS_WINDSHIELD"), false, name);
  }
});

test("windshield wording outside technical EPC 67 is not enough", () => {
  assert.equal(detect({
    article: "A2118250610",
    name: "Windscreen",
    epc: "82",
  }).includes("GLASS_WINDSHIELD"), false);
});
