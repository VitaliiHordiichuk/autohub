import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../config/db.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { ProductCardService } from "./ProductCardService.js";

import {
  SEARCH_FIXTURE,
} from "../../tests/helpers/search-fixture.js";


after(async () => {
  await pool.end();
});


test(
  "собирает карточку оригинала с доступным аналогом",
  async () => {
    const product =
      await ProductRepository
        .findByNormalizedArticle(
          SEARCH_FIXTURE
            .originalNormalized
        );

    const originalQuery = pool.query;
    let offerQueryCount = 0;
    pool.query = function instrumentedQuery(sql, ...args) {
      if (String(sql).includes("WHERE po.product_id = ANY($1::integer[])")) {
        offerQueryCount += 1;
      }
      return originalQuery.call(this, sql, ...args);
    };

    let card;
    try {
      card = await ProductCardService.build(product);
    } finally {
      pool.query = originalQuery;
    }

    assert.ok(card);
    assert.equal(offerQueryCount, 1, "offers for the card and all relations must be loaded in one batch");

    assert.equal(
      card.product.article,
      SEARCH_FIXTURE.originalArticle
    );

    assert.equal(
      card.offers.length,
      0
    );

    assert.equal(
      card.analogs.length,
      1
    );

    assert.equal(
      card.analogs[0]
        .product.article,
      SEARCH_FIXTURE.analogArticle
    );

    assert.equal(
      card.analogs[0]
        .offers.length,
      1
    );

    const analogOffer =
      card.analogs[0]
        .offers[0];

    assert.equal(
      analogOffer.quantity,
      SEARCH_FIXTURE.quantity
    );

    assert.equal(
      analogOffer.retailPrice,
      SEARCH_FIXTURE.manualRetailPrice
    );
  }
);
