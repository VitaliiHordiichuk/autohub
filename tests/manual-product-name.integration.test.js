import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { ProductTranslationService } from "../src/services/ProductTranslationService.js";

let productId = null;

after(async () => {
  if (productId) {
    await pool.query(
      "DELETE FROM products WHERE id = $1",
      [productId]
    );
  }

  await pool.end();
});

test("ручное название переживает последующее обновление названия из прайса", async () => {
  const token = String(Date.now());
  const article = `MANUALNAME${token}`;

  const inserted = await pool.query(
    `
      INSERT INTO products (
        article,
        article_normalized,
        name
      )
      VALUES ($1, $1, $2)
      RETURNING id
    `,
    [article, "Исходное название из прайса"]
  );

  productId = Number(inserted.rows[0].id);

  const defaultLanguage = await pool.query(
    `
      SELECT code
      FROM site_languages
      WHERE is_default = TRUE
      ORDER BY sort_order, code
      LIMIT 1
    `
  );

  assert.ok(defaultLanguage.rows[0]);

  const languageCode =
    defaultLanguage.rows[0].code;

  await ProductTranslationService.save({
    productId,
    languageCode,
    name: "Ручное название товара",
  });

  await pool.query(
    `
      UPDATE products
      SET name = $2
      WHERE id = $1
    `,
    [productId, "Новое название из следующего прайса"]
  );

  const stored = await pool.query(
    `
      SELECT
        product.name,
        translation.name AS translation_name,
        translation.provider
      FROM products product
      JOIN product_translations translation
        ON translation.product_id = product.id
        AND translation.language_code = $2
      WHERE product.id = $1
    `,
    [productId, languageCode]
  );

  assert.equal(
    stored.rows[0].name,
    "Ручное название товара"
  );
  assert.equal(
    stored.rows[0].translation_name,
    "Ручное название товара"
  );
  assert.equal(
    stored.rows[0].provider,
    "MANUAL"
  );
});
