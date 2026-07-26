import test, {
  after,
  before,
} from "node:test";

import assert from "node:assert/strict";

import { app } from "../../src/app.js";
import { pool } from "../../src/config/db.js";


let server;
let baseUrl;


before(async () => {
  server = app.listen(0);

  await new Promise(
    (resolve) => {
      server.once(
        "listening",
        resolve
      );
    }
  );

  const address =
    server.address();

  baseUrl =
    `http://127.0.0.1:${address.port}`;
});


after(async () => {
  await new Promise(
    (resolve, reject) => {
      server.close(
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    }
  );

  await pool.end();
});


test(
  "API находит оригинал и доступный аналог",
  async () => {
    const response =
      await fetch(
        `${baseUrl}/api/search?article=A2711800109`
      );

    assert.equal(
      response.status,
      200
    );


    const body =
      await response.json();

    assert.equal(
      body.success,
      true
    );

    assert.equal(
      body.productCard
        .product.article,
      "A2711800109"
    );

    assert.equal(
      body.productCard
        .offers.length,
      0
    );

    assert.equal(
      body.productCard
        .analogs.length,
      1
    );


    const analog =
      body.productCard
        .analogs[0];

    assert.equal(
      analog.product.article,
      "HU718/5X"
    );

    assert.equal(
      analog.offers.length,
      1
    );


    const analogOffer =
      analog.offers[0];

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

    assert.equal(
      analogOffer.sourceType,
      "OWN_STOCK"
    );

    assert.equal(
      analogOffer.sourceLabel,
      "Наш склад"
    );

    assert.equal(
      analogOffer.availabilityText,
      "Є сьогодні"
    );

    assert.equal(
      Object.hasOwn(
        analogOffer,
        "warehouse"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        analogOffer,
        "purchasePrice"
      ),
      false
    );
  }
);


test(
  "API находит Mercedes без первой буквы",
  async () => {
    const response =
      await fetch(
        `${baseUrl}/api/search?article=2711800109`
      );

    assert.equal(
      response.status,
      200
    );

    const body =
      await response.json();

    assert.equal(
      body.success,
      true
    );

    assert.equal(
      body.searchedArticle,
      "A2711800109"
    );
  }
);


test(
  "API возвращает 404 для неизвестного артикула",
  async () => {
    const response =
      await fetch(
        `${baseUrl}/api/search?article=ZZZ999999`
      );

    assert.equal(
      response.status,
      404
    );

    const body =
      await response.json();

    assert.equal(
      body.success,
      false
    );

    assert.equal(
      body.message,
      "Товар не найден"
    );
  }
);


test(
  "API возвращает 400 без параметра article",
  async () => {
    const response =
      await fetch(
        `${baseUrl}/api/search`
      );

    assert.equal(
      response.status,
      400
    );

    const body =
      await response.json();

    assert.equal(
      body.success,
      false
    );

    assert.equal(
      body.error,
      "Параметр article обязателен"
    );
  }
);
