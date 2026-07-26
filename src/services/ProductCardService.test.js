import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../config/db.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { ProductCardService } from "./ProductCardService.js";


after(async () => {
  await pool.end();
});


test(
  "собирает карточку оригинала с доступным аналогом",
  async () => {
    const product =
      await ProductRepository
        .findByNormalizedArticle(
          "A2711800109"
        );

    const card =
      await ProductCardService
        .build(product);


    assert.ok(card);

    assert.equal(
      card.product.article,
      "A2711800109"
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
      "HU718/5X"
    );

    assert.equal(
      card.analogs[0]
        .offers.length,
      1
    );


    const analogOffer =
      card.analogs[0]
        .offers[0];

    const databaseResult =
      await pool.query(
        `
          SELECT
            quantity,

            CASE
              WHEN price_mode = 'MANUAL'
                AND manual_retail_price IS NOT NULL
              THEN manual_retail_price
              ELSE retail_price
            END AS retail_price

          FROM product_offers

          WHERE id = $1

          LIMIT 1
        `,
        [
          analogOffer.id,
        ]
      );

    const databaseOffer =
      databaseResult.rows[0];

    assert.ok(databaseOffer);

    assert.equal(
      analogOffer.quantity,
      Number(
        databaseOffer.quantity
      )
    );

    assert.equal(
      analogOffer.retailPrice,
      Number(
        databaseOffer.retail_price
      )
    );
  }
);
