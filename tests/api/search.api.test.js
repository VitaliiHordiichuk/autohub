import test, {
  after,
  before,
} from "node:test";

import assert from "node:assert/strict";

import { app } from "../../src/app.js";
import { pool } from "../../src/config/db.js";

import {
  SEARCH_FIXTURE,
} from "../helpers/search-fixture.js";


let server;
let baseUrl;

const ANALYTICS_SESSION_ID =
  "api-search-analytics-test";


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
        `${baseUrl}/api/search?article=${SEARCH_FIXTURE.originalArticle}`,
        {
          headers: {
            "X-Analytics-Session":
              ANALYTICS_SESSION_ID,

            "X-Client-City":
              encodeURIComponent(
                "Харьков"
              ),
          },
        }
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
      SEARCH_FIXTURE.originalArticle
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
      SEARCH_FIXTURE.analogArticle
    );

    assert.equal(
      analog.offers.length,
      1
    );

    const analogOffer =
      analog.offers[0];

    assert.equal(
      analogOffer.quantity,
      SEARCH_FIXTURE.quantity
    );

    assert.equal(
      analogOffer.retailPrice,
      SEARCH_FIXTURE.manualRetailPrice
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

    const analyticsResult =
      await pool.query(
        `
          SELECT
            id,
            user_id,
            raw_query,
            normalized_query,
            searched_article,
            found,
            result_products_count,
            result_offers_count,
            city
          FROM search_events
          WHERE visitor_session_id = $1
          ORDER BY id DESC
          LIMIT 1;
        `,
        [
          ANALYTICS_SESSION_ID,
        ]
      );

    const analyticsEvent =
      analyticsResult.rows[0];

    assert.ok(analyticsEvent);

    assert.equal(
      analyticsEvent.user_id,
      null
    );

    assert.equal(
      analyticsEvent.raw_query,
      SEARCH_FIXTURE.originalArticle
    );

    assert.equal(
      analyticsEvent.normalized_query,
      SEARCH_FIXTURE.originalNormalized
    );

    assert.equal(
      analyticsEvent.searched_article,
      SEARCH_FIXTURE.originalArticle
    );

    assert.equal(
      analyticsEvent.found,
      true
    );

    assert.equal(
      Number(
        analyticsEvent
          .result_products_count
      ) >= 2,
      true
    );

    assert.equal(
      Number(
        analyticsEvent
          .result_offers_count
      ) >= 1,
      true
    );

    assert.equal(
      analyticsEvent.city,
      "Харьков"
    );

    const shownOfferResult =
      await pool.query(
        `
          SELECT
            relation_type,
            article,
            retail_price,
            quantity,
            source_type
          FROM search_event_results
          WHERE search_event_id = $1
            AND product_offer_id = $2
          LIMIT 1;
        `,
        [
          analyticsEvent.id,
          analogOffer.id,
        ]
      );

    const shownOffer =
      shownOfferResult.rows[0];

    assert.ok(shownOffer);

    assert.equal(
      shownOffer.relation_type,
      "ANALOG"
    );

    assert.equal(
      shownOffer.article,
      SEARCH_FIXTURE.analogArticle
    );

    assert.equal(
      Number(
        shownOffer.retail_price
      ),
      SEARCH_FIXTURE.manualRetailPrice
    );

    assert.equal(
      Number(shownOffer.quantity),
      SEARCH_FIXTURE.quantity
    );

    assert.equal(
      shownOffer.source_type,
      "OWN_STOCK"
    );
  }
);


test(
  "API находит Mercedes без первой буквы",
  async () => {
    const response =
      await fetch(
        `${baseUrl}/api/search?article=${SEARCH_FIXTURE.originalWithoutPrefix}`
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
      SEARCH_FIXTURE.originalArticle
    );
  }
);


test(
  "API возвращает живые подсказки по части артикула",
  async () => {
    const prefix =
      SEARCH_FIXTURE.originalArticle.slice(0, 7);

    const response =
      await fetch(
        `${baseUrl}/api/search/suggestions?q=${prefix}&locale=uk&limit=5`
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
      Array.isArray(body.suggestions),
      true
    );

    assert.equal(
      body.suggestions.some(
        (suggestion) =>
          suggestion.article ===
          SEARCH_FIXTURE.originalArticle
      ),
      true
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
      "Товар не знайдено"
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
      "Параметр article є обов’язковим"
    );
  }
);
