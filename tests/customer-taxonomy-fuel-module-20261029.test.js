import test from "node:test";
import assert from "node:assert/strict";
import {
  detectCustomerProductTypes as detect
} from "../src/services/CustomerProductTypeDetector.js";

function types(article, name, epc) {
  return detect({
    article,
    name,
    technicalEpcGroups: [epc]
  });
}

test("fuel pump module does not become tank module", () => {
  const result = types(
    "A1674700394",
    "Модуль паливного насосу",
    "47"
  );

  assert.ok(result.includes("FUEL_PUMP"));
  assert.ok(!result.includes("FUEL_TANK_MODULE"));
});

test("fuel tank module remains recognized", () => {
  const result = types(
    "A9999991234",
    "Модуль паливного бака",
    "47"
  );

  assert.ok(result.includes("FUEL_TANK_MODULE"));
  assert.ok(!result.includes("FUEL_PUMP"));
});

test("explicit NOx sensor follows owner-approved exhaust placement", () => {
  assert.deepEqual(
    types("A000905141287", "Датчик NOX", "90"),
    ["EXHAUST_SENSOR"]
  );
  assert.deepEqual(
    types("A000905141288", "Кронштейн датчика NOX", "90"),
    []
  );
});

test("reviewed EPC98 clip is not auto-promoted", () => {
  assert.deepEqual(
    types("A2019880378", "КЛИП", "98"),
    []
  );
});

test("safety belt is not a service belt", () => {
  const result = types(
    "A22286068009051",
    "Фіксатор замка ременя безпеки",
    "86"
  );

  assert.ok(!result.includes("SERVICE_BELT"));
});
