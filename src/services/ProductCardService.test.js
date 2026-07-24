import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../config/db.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { ProductCardService } from "./ProductCardService.js";

after(async () => {
  await pool.end();
});

test("собирает карточку оригинала с доступным аналогом", async () => {
  const product =
    await ProductRepository.findByNormalizedArticle(
      "A2711800109"
    );

  const card = await ProductCardService.build(product);

  assert.ok(card);
  assert.equal(card.product.article, "A2711800109");
  assert.equal(card.offers.length, 0);

  assert.equal(card.analogs.length, 1);
  assert.equal(
    card.analogs[0].product.article,
    "HU718/5X"
  );

  assert.equal(card.analogs[0].offers.length, 1);
  assert.equal(
    card.analogs[0].offers[0].quantity,
    4
  );
  assert.equal(
    card.analogs[0].offers[0].retailPrice,
    520
  );
});