import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveAutomaticTranslation,
} from "./AutomaticTranslationService.js";


test("неоднозначний переклад ABDECKUNG замінюється оригінальною назвою", () => {
  const cases = [
    ["uk", "ОБСЯГ ПЕРЕКЛАДУ"],
    ["ru", "ОБЛАСТЬ ПРИМЕНЕНИЯ"],
    ["ru", "ОХВАТ"],
    ["en", "COVERAGE"],
  ];

  for (const [languageCode, translatedName] of cases) {
    assert.deepEqual(
      resolveAutomaticTranslation({
        sourceName: "ABDECKUNG",
        languageCode,
        translatedName,
        provider: "DEEPL",
      }),
      {
        name: "ABDECKUNG",
        provider: "IMPORT",
        usedOriginal: true,
      }
    );
  }
});


test("коректний автоматичний переклад залишається без змін", () => {
  assert.deepEqual(
    resolveAutomaticTranslation({
      sourceName: "ABDECKUNG",
      languageCode: "uk",
      translatedName: "Накладка",
      provider: "DEEPL",
    }),
    {
      name: "Накладка",
      provider: "DEEPL",
      usedOriginal: false,
    }
  );
});


test("ручний переклад ніколи не замінюється оригіналом", () => {
  assert.deepEqual(
    resolveAutomaticTranslation({
      sourceName: "ABDECKUNG",
      languageCode: "uk",
      translatedName: "ОБСЯГ ПЕРЕКЛАДУ",
      provider: "MANUAL",
    }),
    {
      name: "ОБСЯГ ПЕРЕКЛАДУ",
      provider: "MANUAL",
      usedOriginal: false,
    }
  );
});
