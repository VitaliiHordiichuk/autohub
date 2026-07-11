import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../config/db.js";
import { SearchService } from "./SearchService.js";

after(async () => {
  await pool.end();
});

test("находит точный оригинальный Mercedes-артикул", async () => {
  const result =
    await SearchService.searchByArticle("A2711800109");

  assert.equal(result.found, true);
  assert.equal(result.rule, "MERCEDES");
  assert.equal(result.exactProduct.article, "A2711800109");
  assert.equal(result.family.length, 4);
});

test("находит Mercedes после нормализации ввода", async () => {
  const result =
    await SearchService.searchByArticle("а 271-180 01 09");

  assert.equal(result.found, true);
  assert.equal(result.normalized, "A2711800109");
  assert.equal(result.exactProduct.article, "A2711800109");
});

test("точный SAME остаётся главным результатом", async () => {
  const result =
    await SearchService.searchByArticle("A271180010964");

  assert.equal(result.found, true);
  assert.equal(result.exactProduct.article, "A271180010964");
  assert.equal(result.parsed.variantType, "SAME");
  assert.equal(result.family.length, 4);
});

test("точный цветовой VARIANT остаётся отдельной карточкой", async () => {
  const result =
    await SearchService.searchByArticle("A27118001099051");

  assert.equal(result.found, true);
  assert.equal(result.exactProduct.article, "A27118001099051");
  assert.equal(result.parsed.variantType, "VARIANT");
  assert.equal(result.family.length, 4);
});

test("находит Mercedes A без первой буквы", async () => {
  const result =
    await SearchService.searchByArticle("2711800109");

  assert.equal(result.found, true);
  assert.equal(result.searchedArticle, "A2711800109");
  assert.equal(result.exactProduct.article, "A2711800109");
});

test("возвращает found false для неизвестного артикула", async () => {
  const result =
    await SearchService.searchByArticle("ZZZ999999");

  assert.equal(result.found, false);
  assert.equal(result.exactProduct, null);
});