import test, {
  after,
  before,
} from "node:test";

import assert from "node:assert/strict";

import {
  app,
} from "../../src/app.js";

import {
  pool,
} from "../../src/config/db.js";


let server;
let baseUrl;
let productId;

const sessionId =
  `funnel-api-${Date.now()}`;


before(async () => {
  const productResult =
    await pool.query(
      `
        SELECT id
        FROM products
        ORDER BY id
        LIMIT 1;
      `
    );

  productId = Number(
    productResult.rows[0]?.id
  );

  assert.ok(
    productId,
    "В тестовой базе отсутствует товар"
  );

  server = app.listen(0);

  await new Promise(
    (resolve) => {
      server.once(
        "listening",
        resolve
      );
    }
  );

  const address = server.address();
  baseUrl =
    `http://127.0.0.1:${address.port}`;
});


after(async () => {
  if (server) {
    await new Promise(
      (resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }
    );
  }

  await pool.query(
    `
      DELETE FROM funnel_events
      WHERE visitor_session_id = $1;
    `,
    [sessionId]
  );

  await pool.end();
});


test(
  "API фиксирует просмотр товара и убирает быстрый дубль",
  async () => {
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(
        `${baseUrl}/api/analytics/funnel`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            "X-Analytics-Session":
              sessionId,
          },
          body: JSON.stringify({
            eventType: "PRODUCT_VIEW",
            productId,
            source: "PRODUCT_PAGE",
            locale: "uk",
          }),
        }
      );

      const body =
        await response.json();

      assert.equal(
        response.status,
        202,
        body.error
      );
    }

    const result =
      await pool.query(
        `
          SELECT *
          FROM funnel_events
          WHERE visitor_session_id = $1;
        `,
        [sessionId]
      );

    assert.equal(
      result.rowCount,
      1
    );
    assert.equal(
      result.rows[0].event_type,
      "PRODUCT_VIEW"
    );
    assert.equal(
      Number(
        result.rows[0].product_id
      ),
      productId
    );
  }
);


test(
  "API отклоняет создание серверного этапа",
  async () => {
    const response = await fetch(
      `${baseUrl}/api/analytics/funnel`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "X-Analytics-Session":
            sessionId,
        },
        body: JSON.stringify({
          eventType: "ORDER_CREATED",
          productId,
        }),
      }
    );

    assert.equal(
      response.status,
      400
    );
  }
);
