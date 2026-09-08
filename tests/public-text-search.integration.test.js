import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/config/db.js";
import { PublicSearchSuggestionRepository as search } from "../src/repositories/PublicSearchSuggestionRepository.js";

after(() => pool.end());

test("text search agrees with suggestions, paginates, respects manual names and escapes wildcards", async () => {
  assert.match(process.env.DB_NAME || "", /_test$/, "Must run on an isolated test database");
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    const tag = `txt${Date.now()}`;
    const ids = [];
    for (let index = 0; index < 27; index++) {
      const row = await db.query(`INSERT INTO products(article, article_normalized, name, is_active)
        VALUES($1,$1,$2,$3) RETURNING id`, [`TXT${Date.now()}${index}`, `${tag} Колодки гальмівні ${index}`, index < 26]);
      ids.push(row.rows[0].id);
    }
    await db.query(`INSERT INTO product_translations(product_id, language_code, name, provider)
      VALUES($1,'uk',$2,'MANUAL')`, [ids[0], `${tag} КОЛОДКИ РУЧНЕ ІМ'Я`]);
    const query = `${tag} тормозные колодки`;
    const first = await search.search({ query, locale: "uk" }, db);
    const next = await search.search({ query, locale: "uk", page: 2 }, db);
    const suggestions = await search.list({ query, locale: "uk" }, db);
    assert.equal(first.pagination.total, 26);
    assert.equal(first.products.length, 24);
    assert.equal(next.products.length, 2);
    assert.equal(new Set([...first.products, ...next.products].map(p => p.id)).size, 26);
    assert.deepEqual(suggestions.map(p => p.id), first.products.slice(0, 8).map(p => p.id));
    assert.ok([...first.products, ...next.products].some(p => p.name === `${tag} КОЛОДКИ РУЧНЕ ІМ'Я`));
    assert.equal((await search.search({ query: `${tag} %` }, db)).pagination.total, 0);
    assert.equal((await search.search({ query: `${tag} _` }, db)).pagination.total, 0);
    assert.equal((await search.search({ query: "null" }, db)).pagination.total, 0);
    assert.equal((await search.search({ query, page: "1.5" }, db)).pagination.page, 1);
    const invalidPage = await search.search({ query, page: 99 }, db);
    assert.equal(invalidPage.pagination.total, 26);
    assert.equal(invalidPage.products.length, 0);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
