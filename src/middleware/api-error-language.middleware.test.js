import test from "node:test";
import assert from "node:assert/strict";

import {
  apiErrorLanguageTest,
} from "./api-error-language.middleware.js";

test("замінює російський текст помилки українським", () => {
  const result = apiErrorLanguageTest.withoutRussianErrorText(
    { success: false, code: "ORDER_NOT_FOUND", error: "Заказ не найден" },
    "uk",
    404
  );

  assert.equal(
    result.error,
    "Не вдалося виконати дію. Перевірте дані та спробуйте ще раз."
  );
  assert.equal(result.code, "ORDER_NOT_FOUND");
});

test("не змінює українську помилку", () => {
  const payload = { success: false, error: "Товар не знайдено" };
  assert.equal(
    apiErrorLanguageTest.withoutRussianErrorText(payload, "uk", 404),
    payload
  );
});

test("для англійської локалі повертає англійський безпечний текст", () => {
  const result = apiErrorLanguageTest.withoutRussianErrorText(
    { error: "Некорректный номер заказа" },
    "en",
    400
  );

  assert.equal(
    result.error,
    "The action could not be completed. Check the data and try again."
  );
});
