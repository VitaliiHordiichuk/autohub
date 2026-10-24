import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTelegramLocale, TelegramLanguageService, telegramLanguageKeyboard,
} from "./TelegramLanguageService.js";

test("default Ukrainian and only supported explicit English", async () => {
  const db = {query: async () => ({rows: []})};
  assert.equal(await TelegramLanguageService.get(1001, db), "uk");
  assert.equal(normalizeTelegramLocale("ru"), "uk");
  assert.equal(normalizeTelegramLocale("en"), "en");
  assert.equal(normalizeTelegramLocale(undefined), "uk");
});
test("language persists through independent SQL updates", async () => {
  let current = null;
  const db = {
    query: async (sql, args) => {
      if (sql.includes("SELECT")) return {rows: current ? [{locale: current}] : []};
      if (sql.includes("INSERT")) { current = args[1]; return {rows: []}; }
      throw new Error("Unexpected query");
    },
  };
  await TelegramLanguageService.set(1001, "en", db);
  assert.equal(await TelegramLanguageService.get(1001, db), "en");
  await TelegramLanguageService.set(1001, "uk", db);
  assert.equal(await TelegramLanguageService.get(1001, db), "uk");
  await assert.rejects(TelegramLanguageService.set(1001, "ru", db), /Invalid/);
});
test("language selector contains only Ukrainian and English", () => {
  const keyboard = telegramLanguageKeyboard("en");
  assert.deepEqual(keyboard.inline_keyboard[0].map(b => b.callback_data), ["lang:uk", "lang:en"]);
  assert.match(keyboard.inline_keyboard[0][1].text, /English/);
  assert.doesNotMatch(JSON.stringify(keyboard), /рус|ru:/i);
});
