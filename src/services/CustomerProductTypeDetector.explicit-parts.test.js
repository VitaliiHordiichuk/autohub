import test from "node:test";
import assert from "node:assert/strict";
import { detectCustomerProductTypes } from "./CustomerProductTypeDetector.js";

function detected(article, name, epc, translations = []) {
  return detectCustomerProductTypes({
    article, articleNormalized: article, name,
    translations: translations.map((translation) => ({ name: translation })),
    technicalEpcGroups: epc ? [epc] : [],
  });
}

test("explicit battery wording with electrical EPC recognizes current and future stock", () => {
  assert.deepEqual(detected("A001982790826", "Акумулятор 12V/60ah", "98"), ["ELECTRICAL_BATTERY"]);
  assert.ok(detected("A8889800001", "12V/75Ah battery", "98").includes("ELECTRICAL_BATTERY"));
  assert.ok(detected("A8885400001", "Аккумулятор 12 В", "54").includes("ELECTRICAL_BATTERY"));
  for (const [name, epc] of [
    ["Кронштейн акумулятора", "98"],
    ["Battery cable", "98"],
    ["Акумулятор 12 В", "35"],
  ]) assert.ok(!detected("A8889800002", name, epc).includes("ELECTRICAL_BATTERY"), name);
});

test("NOx sensor is an exhaust sensor even when historically reviewed, not its holder", () => {
  assert.deepEqual(detected("A0009053119", "Датчик NOX", "90"), ["EXHAUST_SENSOR"]);
  assert.deepEqual(detected("A8889000001", "NOx sensor", "90"), ["EXHAUST_SENSOR"]);
  assert.deepEqual(detected("A8889000003", "Датчик NOХ", "90"), ["EXHAUST_SENSOR"]);
  assert.deepEqual(detected("A8889000004", "ДатчикNOX", "90"), ["EXHAUST_SENSOR"]);
  assert.ok(!detected("A8889000002", "Кронштейн датчика NOx", "90").includes("EXHAUST_SENSOR"));
  assert.ok(!detected("A8883500001", "NOx sensor", "35").includes("EXHAUST_SENSOR"));
});

test("owner-approved EPC 15 pressure valves use the engine-sensors leaf without broad valve matching", () => {
  assert.deepEqual(detected("A0001532000", "Клапан тиску", "15"), ["ENGINE_SENSOR"]);
  assert.deepEqual(detected("A0001532600", "Клапан давления", "15"), ["ENGINE_SENSOR"]);
  assert.deepEqual(detected("A8881500001", "Pressure valve", "15"), ["ENGINE_SENSOR"]);
  for (const [name, epc] of [
    ["Клапан тиску палива", "15"],
    ["Клапан тиску", "47"],
    ["Датчик тиску", "15"],
    ["Клапан EGR", "15"],
  ]) assert.ok(!detected("A8881500002", name, epc).includes("ENGINE_SENSOR"), name);
  assert.ok(!detected("A8881500003", "Клапан тиску", "15", ["Fuel pressure valve"]).includes("ENGINE_SENSOR"));
});

test("subframes and rear axle beams require suspension EPC and exclude loose fasteners", () => {
  assert.deepEqual(detected("A212350380564", "Балка моста заднього", "35"), ["SUSPENSION_SUBFRAME_MOUNT"]);
  assert.deepEqual(detected("A8883500001", "Rear axle beam", "35"), ["SUSPENSION_SUBFRAME_MOUNT"]);
  assert.deepEqual(detected("A8883300001", "Подрамник передний", "33"), ["SUSPENSION_SUBFRAME_MOUNT"]);
  assert.ok(!detected("A8883500002", "Болт підрамника", "35").includes("SUSPENSION_SUBFRAME_MOUNT"));
  assert.ok(!detected("A8888800001", "Балка бампера", "88").includes("SUSPENSION_SUBFRAME_MOUNT"));
});

test("explicit AdBlue/SCR wording works in observed EPC groups, not generic exhaust or unrelated EPC", () => {
  assert.deepEqual(detected("A000140447880", "Насос системи AdBlue", "14"), ["ADBLUE_SCR_COMPONENT"]);
  assert.deepEqual(detected("A8884700001", "Бачок AdBlue", "47"), ["ADBLUE_SCR_COMPONENT"]);
  assert.deepEqual(detected("A8884900001", "Форсунка AdBlue", "49"), ["EXHAUST_ADBLUE_INJECTOR"]);
  assert.deepEqual(detected("A8889000001", "Датчик тиску системи AdBlue", "90"), ["ADBLUE_SCR_COMPONENT"]);
  assert.deepEqual(detected("A8881500001", "Клапан тиску AdBlue", "15"), ["ADBLUE_SCR_COMPONENT"]);
  assert.deepEqual(detected("A8889800001", "Реагент AdBlue", "98"), ["ADBLUE_SCR_COMPONENT"]);
  assert.ok(!detected("A8881400001", "Насос повітряний", "14").includes("ADBLUE_SCR_COMPONENT"));
  assert.ok(!detected("A8886500001", "AdBlue pump", "65").includes("ADBLUE_SCR_COMPONENT"));
  assert.ok(!detected("A8881400002", "Screen holder", "14").includes("ADBLUE_SCR_COMPONENT"));
});
