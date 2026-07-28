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


let server;
let baseUrl;
let userId;
let eventId;
let token;

const testQuery =
  `AUTOHUB_ANALYTICS_${Date.now()}`;


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
        RETURNING id;
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

  token = jwt.sign(
    {
      sub: String(userId),
      role: "ADMIN",
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

  if (userId) {
    await pool.query(
      `
        DELETE FROM users
        WHERE id = $1;
      `,
      [userId]
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
