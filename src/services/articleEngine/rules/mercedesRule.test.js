import test from "node:test";
import assert from "node:assert/strict";

import { parseMercedesArticle } from "./mercedesRule.js";

test("определяет BASE Mercedes A", () => {
  assert.deepEqual(parseMercedesArticle("A2711800109"), {
    rule: "MERCEDES",
    normalized: "A2711800109",
    prefix: "A",
    articleBase: "A2711800109",
    articleSuffix: "",
    suffixLength: 0,
    variantType: "BASE",
  });
});

test("определяет SAME Mercedes A", () => {
  const result = parseMercedesArticle("A271180010964");

  assert.equal(result.articleBase, "A2711800109");
  assert.equal(result.articleSuffix, "64");
  assert.equal(result.variantType, "SAME");
});

test("определяет VARIANT Mercedes A", () => {
  const result = parseMercedesArticle("A27118001099051");

  assert.equal(result.articleBase, "A2711800109");
  assert.equal(result.articleSuffix, "9051");
  assert.equal(result.variantType, "VARIANT");
});

test("определяет BASE Mercedes B", () => {
  const result = parseMercedesArticle("B12345678");

  assert.equal(result.articleBase, "B12345678");
  assert.equal(result.variantType, "BASE");
});

test("определяет BASE Mercedes N", () => {
  const result = parseMercedesArticle("N000000006469");

  assert.equal(result.articleBase, "N000000006469");
  assert.equal(result.variantType, "BASE");
});

test("возвращает null для неизвестного префикса", () => {
  assert.equal(parseMercedesArticle("H000000006469"), null);
});