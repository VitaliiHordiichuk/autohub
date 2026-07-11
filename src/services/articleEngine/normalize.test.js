import test from "node:test";
import assert from "node:assert/strict";

import { normalizeArticle } from "./normalize.js";

test("нормализует Mercedes-артикул", () => {
  assert.equal(normalizeArticle("A2711800109"), "A2711800109");
  assert.equal(normalizeArticle("a2711800109"), "A2711800109");
  assert.equal(normalizeArticle("А2711800109"), "A2711800109");
  assert.equal(normalizeArticle("A 271-180 01.09"), "A2711800109");
});

test("нормализует артикул MANN", () => {
  assert.equal(normalizeArticle("HU718/5X"), "HU7185X");
});

test("корректно обрабатывает пустое значение", () => {
  assert.equal(normalizeArticle(""), "");
  assert.equal(normalizeArticle(null), "");
  assert.equal(normalizeArticle(undefined), "");
});

test("кириллическая Н превращается в латинскую H", () => {
  assert.equal(normalizeArticle("Н000000006469"), "H000000006469");
});