import assert from "node:assert/strict";
import test from "node:test";

import { detectCustomerProductTypes } from "./CustomerProductTypeDetector.js";

const cases = [
  { article: "A2122406417", epc: "24", type: "ENGINE_MOUNT", names: ["Подушка двигуна", "Подушка двигателя", "Engine mount"] },
  { article: "A2122406317", epc: "24", type: "ENGINE_MOUNT", names: ["Подушка двигуна", "Опора двигателя", "Engine mount"] },
  { article: "A2532400700", epc: "24", type: "ENGINE_MOUNT", names: ["Подушка двигуна", "Подушка двигателя", "Engine mount"] },
  { article: "A2533200630", epc: "32", type: "SUSPENSION_SHOCK_ABSORBER", names: ["Амортизатор", "Амортизатор подвески", "Suspension shock absorber"] },
  { article: "A2533200530", epc: "32", type: "SUSPENSION_SHOCK_ABSORBER", names: ["Амортизатор", "Амортизатор подвески", "Shock absorber"] },
  { article: "A1676901508", epc: "69", type: "BODY_WHEEL_ARCH_LINER", names: ["Підкрилок", "Подкрылок", "Wheel arch liner"] },
  { article: "A1678801709", epc: "88", type: "BODY_FENDER", names: ["Крило передне", "Переднее крыло", "Front wing"] },
  { article: "A1678850110", epc: "88", type: "BODY_BUMPER_MOUNT", names: ["Кронштейн бампера", "Кронштейн бампера", "Bumper bracket"] },
  { article: "A4477306802", epc: "73", type: "BODY_LOCK_LATCH", names: ["Замок дверей", "Замок двери", "Door lock"] },
  { article: "A223540844464", epc: "54", type: "ELECTRICAL_FUSE_BOX", names: ["Блок запобіжників", "Блок предохранителей", "Fuse block"] },
  { article: "A001982790826", epc: "98", type: "ELECTRICAL_BATTERY", names: ["Акумулятор 12V/60Ah", "Аккумулятор 12 В", "12V battery"] },
  { article: "A4603330314", epc: "33", type: "SUSPENSION_BUSHING_MOUNT", names: ["Сайлентблок важіля підвіски", "Сайлентблок рычага подвески", "Suspension arm silent block"] },
  { article: "A6510520200", epc: "05", type: "ENGINE_TIMING_COMPONENT", names: ["Шестерня валу розподільчого", "Шестерня распредвала", "Camshaft gear"] },
  { article: "A1560101972", epc: "01", type: "ENGINE_OIL_SYSTEM_COMPONENT", names: ["Щуп оливи двигуна", "Щуп масла двигателя", "Engine oil dipstick"] },
];

function detected(article, epc, name, translations = []) {
  return detectCustomerProductTypes({
    article,
    name,
    translations: translations.map((translationName) => ({ name: translationName })),
    technicalEpcGroups: [epc],
  });
}

test("all 14 precise candidates are recognized in their existing EPC context", () => {
  for (const { article, epc, type, names } of cases) {
    for (const name of names) {
      assert.ok(detected(article, epc, name).includes(type), `${article}: ${name}`);
    }
  }
});

test("a precise name without the matching EPC never gets the new type", () => {
  for (const { article, type, names } of cases) {
    assert.equal(detected(article, "99", names[0]).includes(type), false, article);
  }
});

test("related components and generic names do not become the complete parts", () => {
  const related = [
    ["24", "ENGINE_MOUNT", "Подушка КПП / gearbox mount"],
    ["24", "ENGINE_MOUNT", "Кронштейн опоры двигателя"],
    ["32", "SUSPENSION_SHOCK_ABSORBER", "Амортизатор кришки багажника"],
    ["32", "SUSPENSION_SHOCK_ABSORBER", "Пружина амортизатора"],
    ["32", "SUSPENSION_SHOCK_ABSORBER", "Амортизатор двигателя"],
    ["69", "BODY_WHEEL_ARCH_LINER", "Накладка підкрилка"],
    ["88", "BODY_FENDER", "Накладка переднього крила / front fender trim"],
    ["88", "BODY_FENDER", "Front fender support"],
    ["88", "BODY_BUMPER_MOUNT", "Накладка бампера / bumper trim"],
    ["73", "BODY_LOCK_LATCH", "Корпус замка дверей"],
    ["73", "BODY_LOCK_LATCH", "Замок зажигания / ignition lock"],
    ["73", "BODY_LOCK_LATCH", "Door lock actuator"],
    ["54", "ELECTRICAL_FUSE_BOX", "Запобіжник / single fuse"],
    ["54", "ELECTRICAL_FUSE_BOX", "Кришка блока запобіжників"],
    ["54", "ELECTRICAL_FUSE_BOX", "Fuse box cable"],
    ["98", "ELECTRICAL_BATTERY", "Кронштейн акумулятора 12V"],
    ["33", "SUSPENSION_BUSHING_MOUNT", "Кронштейн сайлентблока рычага подвески"],
    ["05", "ENGINE_TIMING_COMPONENT", "Датчик шестерни распредвала"],
    ["01", "ENGINE_OIL_SYSTEM_COMPONENT", "Трубка щупа масла двигателя"],
  ];
  for (const [epc, type, name] of related) {
    const article = `A999${epc}00001`;
    assert.equal(detected(article, epc, name).includes(type), false, name);
  }
});

test("contradictory translations veto an otherwise matching new type", () => {
  assert.equal(detected("A9993200001", "32", "Амортизатор", ["Boot lid shock absorber"])
    .includes("SUSPENSION_SHOCK_ABSORBER"), false);
  assert.equal(detected("A9998800001", "88", "Крило передне", ["Front fender trim"])
    .includes("BODY_FENDER"), false);
});
