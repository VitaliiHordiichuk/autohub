import test, {
  after,
  before,
} from "node:test";

import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import {
  app,
} from "../../src/app.js";

import {
  pool,
} from "../../src/config/db.js";

import {
  SEARCH_FIXTURE,
} from "../helpers/search-fixture.js";


let server;
let baseUrl;
let userId;
let clientUserId;
let eventId;
let funnelEventIds = [];
let token;
let clientToken;

const testQuery =
  `AUTOHUB_ANALYTICS_${Date.now()}`;

const regressionSessionId =
  `analytics-consent-independent-${Date.now()}`;

const authenticatedSessionId =
  `analytics-authenticated-${Date.now()}`;


before(async () => {
  const roleResult =
    await pool.query(
      `
        SELECT id
        FROM roles
        WHERE name = 'ADMIN'
        LIMIT 1;
      `
    );

  const roleId =
    roleResult.rows[0]?.id;

  assert.ok(
    roleId,
    "В тестовой базе отсутствует роль ADMIN"
  );

  const userResult =
    await pool.query(
      `
        INSERT INTO users (
          first_name,
          last_name,
          email,
          password_hash,
          role_id,
          is_active
        )
        VALUES (
          'Analytics',
          'Test',
          $1,
          'test-password-hash',
          $2,
          TRUE
        )
        RETURNING id, auth_version;
      `,
      [
        `analytics.${Date.now()}@example.invalid`,
        roleId,
      ]
    );

  userId = Number(
    userResult.rows[0].id
  );

  const eventResult =
    await pool.query(
      `
        INSERT INTO search_events (
          event_type,
          visitor_session_id,
          user_id,
          raw_query,
          normalized_query,
          searched_article,
          search_rule,
          locale,
          found,
          result_products_count,
          result_offers_count,
          city,
          country_code
        )
        VALUES (
          'SEARCH',
          'analytics-test-session',
          $1,
          $2,
          $2,
          $2,
          'DEFAULT',
          'uk',
          FALSE,
          0,
          0,
          'Харьков',
          'UA'
        )
        RETURNING id;
      `,
      [
        userId,
        testQuery,
      ]
    );

  eventId = Number(
    eventResult.rows[0].id
  );

  const funnelResult =
    await pool.query(
      `
        INSERT INTO funnel_events (
          event_type,
          visitor_session_id,
          user_id,
          created_at
        )
        SELECT
          event_type,
          'analytics-test-session',
          $1,
          CURRENT_TIMESTAMP
        FROM UNNEST(
          ARRAY[
            'PRODUCT_VIEW',
            'ADD_TO_CART',
            'CHECKOUT_STARTED',
            'ORDER_CREATED',
            'VIN_REQUEST_CREATED'
          ]::text[]
        ) AS event_type
        RETURNING id;
      `,
      [userId]
    );

  funnelEventIds =
    funnelResult.rows.map(
      (row) => Number(row.id)
    );

  token = jwt.sign(
    {
      sub: String(userId),
      role: "ADMIN",
      authVersion: Number(
        userResult.rows[0]
          .auth_version || 0
      ),
    },
    process.env.AUTH_JWT_SECRET,
    {
      expiresIn: "10m",
      issuer: "autohub-backend",
      audience: "autohub-client",
    }
  );

  const clientRoleResult =
    await pool.query(
      `
        SELECT id
        FROM roles
        WHERE name = 'CLIENT'
        LIMIT 1;
      `
    );

  assert.ok(
    clientRoleResult.rows[0]?.id,
    "В тестовой базе отсутствует роль CLIENT"
  );

  const clientUserResult =
    await pool.query(
      `
        INSERT INTO users (
          first_name,
          last_name,
          email,
          password_hash,
          role_id,
          is_active
        )
        VALUES (
          'Analytics client',
          'Test',
          $1,
          'test-password-hash',
          $2,
          TRUE
        )
        RETURNING id, auth_version;
      `,
      [
        `analytics.client.${Date.now()}@example.invalid`,
        clientRoleResult.rows[0].id,
      ]
    );

  clientUserId = Number(
    clientUserResult.rows[0].id
  );

  clientToken = jwt.sign(
    {
      sub: String(clientUserId),
      role: "CLIENT",
      authVersion: Number(
        clientUserResult.rows[0]
          .auth_version || 0
      ),
    },
    process.env.AUTH_JWT_SECRET,
    {
      expiresIn: "10m",
      issuer: "autohub-backend",
      audience: "autohub-client",
    }
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

  const address =
    server.address();

  baseUrl =
    `http://127.0.0.1:${address.port}`;
});


after(async () => {
  if (server) {
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
  }

  if (eventId) {
    await pool.query(
      `
        DELETE FROM search_events
        WHERE id = $1;
      `,
      [eventId]
    );
  }

  await pool.query(
    `
      DELETE FROM funnel_events
      WHERE visitor_session_id = ANY($1::text[]);
    `,
    [[
      regressionSessionId,
      authenticatedSessionId,
    ]]
  );

  await pool.query(
    `
      DELETE FROM search_events
      WHERE visitor_session_id = ANY($1::text[]);
    `,
    [[
      regressionSessionId,
      authenticatedSessionId,
    ]]
  );

  if (funnelEventIds.length) {
    await pool.query(
      `
        DELETE FROM funnel_events
        WHERE id = ANY($1::bigint[]);
      `,
      [funnelEventIds]
    );
  }

  if (userId) {
    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1;
      `,
      [userId]
    );
  }

  if (clientUserId) {
    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1;
      `,
      [clientUserId]
    );
  }

  await pool.end();
});


test(
  "администратор получает поисковую аналитику",
  async () => {
    const response = await fetch(
      `${baseUrl}/api/admin/search-analytics?days=30&status=NOT_FOUND&search=${encodeURIComponent(
        testQuery
      )}`,
      {
        headers: {
          Cookie:
            `autohub_token=${token}`,
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
      body.filters.status,
      "NOT_FOUND"
    );

    assert.ok(
      body.summary.searches >= 1
    );

    assert.ok(
      body.missingQueries.some(
        (item) =>
          item.query === testQuery
      )
    );

    assert.ok(
      body.recent.rows.some(
        (item) =>
          item.id === eventId &&
          item.user?.id === userId
      )
    );

    assert.deepEqual(
      body.funnel.stages.map(
        (stage) => stage.key
      ),
      [
        "SEARCH",
        "PRODUCT_VIEW",
        "ADD_TO_CART",
        "CHECKOUT_STARTED",
        "ORDER_CREATED",
      ]
    );

    assert.ok(
      body.funnel.stages.every(
        (stage) =>
          stage.visitors >= 1
      )
    );

    assert.ok(
      body.funnel.vinRequest.visitors >= 1
    );
  }
);


test(
  "поисковая аналитика закрыта без авторизации",
  async () => {
    const response = await fetch(
      `${baseUrl}/api/admin/search-analytics`
    );

    assert.equal(
      response.status,
      401
    );
  }
);


function stage(body, key) {
  return body.funnel.stages.find(
    (item) => item.key === key
  );
}


async function adminAnalytics() {
  const response = await fetch(
    `${baseUrl}/api/admin/search-analytics?days=30&limit=100`,
    {
      headers: {
        Cookie:
          `autohub_token=${token}`,
      },
    }
  );

  assert.equal(response.status, 200);
  return response.json();
}


async function searchAndView({
  sessionId,
  authToken,
}) {
  const headers = {
    "X-Analytics-Session":
      sessionId,
  };

  if (authToken) {
    headers.Cookie =
      `autohub_token=${authToken}`;
  }

  const searchResponse = await fetch(
    `${baseUrl}/api/search?article=${SEARCH_FIXTURE.originalArticle}&locale=uk`,
    { headers }
  );

  assert.equal(searchResponse.status, 200);
  const searchBody =
    await searchResponse.json();
  const productId = Number(
    searchBody.productCard.product.id
  );

  for (let index = 0; index < 2; index += 1) {
    const viewResponse = await fetch(
      `${baseUrl}/api/analytics/funnel`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          eventType: "PRODUCT_VIEW",
          productId,
          source: "PRODUCT_PAGE",
          locale: "uk",
        }),
      }
    );

    assert.equal(viewResponse.status, 202);
  }

  return productId;
}


test(
  "анонимные события реально сохраняются, дедуплируются и видны в админской аналитике",
  async () => {
    const beforeDashboard =
      await adminAnalytics();

    const productId =
      await searchAndView({
        sessionId:
          regressionSessionId,
      });

    const searchResult =
      await pool.query(
        `
          SELECT *
          FROM search_events
          WHERE visitor_session_id = $1;
        `,
        [regressionSessionId]
      );

    assert.equal(searchResult.rowCount, 1);
    const searchEvent =
      searchResult.rows[0];
    assert.equal(searchEvent.user_id, null);
    assert.equal(
      searchEvent.raw_query,
      SEARCH_FIXTURE.originalArticle
    );
    assert.equal(searchEvent.found, true);
    assert.equal(
      Number(searchEvent.exact_product_id),
      productId
    );
    assert.ok(
      Number(
        searchEvent.result_products_count
      ) >= 2
    );
    assert.ok(
      Number(
        searchEvent.result_offers_count
      ) >= 1
    );

    const shownOfferResult =
      await pool.query(
        `
          SELECT
            article,
            retail_price,
            quantity,
            source_type
          FROM search_event_results
          WHERE search_event_id = $1
            AND article = $2
          LIMIT 1;
        `,
        [
          searchEvent.id,
          SEARCH_FIXTURE.analogArticle,
        ]
      );

    assert.equal(
      shownOfferResult.rowCount,
      1
    );
    assert.equal(
      Number(
        shownOfferResult.rows[0]
          .retail_price
      ),
      SEARCH_FIXTURE.manualRetailPrice
    );
    assert.equal(
      Number(
        shownOfferResult.rows[0]
          .quantity
      ),
      SEARCH_FIXTURE.quantity
    );
    assert.equal(
      shownOfferResult.rows[0]
        .source_type,
      "OWN_STOCK"
    );

    const funnelResult =
      await pool.query(
        `
          SELECT *
          FROM funnel_events
          WHERE visitor_session_id = $1;
        `,
        [regressionSessionId]
      );

    assert.equal(funnelResult.rowCount, 1);
    assert.equal(
      funnelResult.rows[0].event_type,
      "PRODUCT_VIEW"
    );
    assert.equal(
      Number(
        funnelResult.rows[0].product_id
      ),
      productId
    );

    const afterDashboard =
      await adminAnalytics();
    const recent =
      afterDashboard.recent.rows.find(
        (item) =>
          item.visitorSessionId ===
          regressionSessionId
      );

    assert.ok(recent);
    assert.equal(recent.user, null);
    assert.equal(recent.found, true);
    assert.equal(
      recent.exactProductId,
      productId
    );
    assert.ok(
      recent.results.some(
        (item) =>
          item.article ===
            SEARCH_FIXTURE.analogArticle &&
          item.retailPrice ===
            SEARCH_FIXTURE.manualRetailPrice &&
          item.quantity ===
            SEARCH_FIXTURE.quantity
      )
    );
    assert.equal(
      afterDashboard.summary.searches,
      beforeDashboard.summary.searches + 1
    );
    assert.equal(
      stage(afterDashboard, "SEARCH")
        .events,
      stage(beforeDashboard, "SEARCH")
        .events + 1
    );
    assert.equal(
      stage(
        afterDashboard,
        "PRODUCT_VIEW"
      ).events,
      stage(
        beforeDashboard,
        "PRODUCT_VIEW"
      ).events + 1
    );
  }
);


test(
  "поиск и просмотр авторизованного покупателя связываются только с проверенным user_id",
  async () => {
    const productId =
      await searchAndView({
        sessionId:
          authenticatedSessionId,
        authToken: clientToken,
      });

    const searchResult =
      await pool.query(
        `
          SELECT user_id
          FROM search_events
          WHERE visitor_session_id = $1;
        `,
        [authenticatedSessionId]
      );
    const funnelResult =
      await pool.query(
        `
          SELECT user_id, product_id
          FROM funnel_events
          WHERE visitor_session_id = $1;
        `,
        [authenticatedSessionId]
      );

    assert.equal(searchResult.rowCount, 1);
    assert.equal(funnelResult.rowCount, 1);
    assert.equal(
      Number(searchResult.rows[0].user_id),
      clientUserId
    );
    assert.equal(
      Number(funnelResult.rows[0].user_id),
      clientUserId
    );
    assert.equal(
      Number(funnelResult.rows[0].product_id),
      productId
    );

    const dashboard =
      await adminAnalytics();
    const recent =
      dashboard.recent.rows.find(
        (item) =>
          item.visitorSessionId ===
          authenticatedSessionId
      );

    assert.ok(recent);
    assert.equal(
      recent.user?.id,
      clientUserId
    );
  }
);
