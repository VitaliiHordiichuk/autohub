import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import { app } from "../../src/app.js";
import { pool } from "../../src/config/db.js";

let server;
let baseUrl;
const authUsers = new Map();
let createdManagerId = null;

function tokenFor(role) {
  const user = authUsers.get(role);
  if (!user) throw new Error(`Тестовый пользователь ${role} не найден`);
  return jwt.sign(
    {
      sub: String(user.id),
      role,
      authVersion: Number(user.auth_version || 0),
    },
    process.env.AUTH_JWT_SECRET,
    {
      expiresIn: "10m",
      issuer: "autohub-backend",
      audience: "autohub-client",
    }
  );
}

before(async () => {
  const users = await pool.query(
    `
      SELECT DISTINCT ON (r.name) u.id, u.auth_version, r.name AS role
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE r.name IN ('ADMIN', 'MANAGER')
        AND u.is_active = TRUE
        AND u.must_change_password = FALSE
      ORDER BY r.name, u.id;
    `
  );
  for (const user of users.rows) authUsers.set(user.role, user);

  if (!authUsers.has("MANAGER")) {
    const role = await pool.query("SELECT id FROM roles WHERE name = 'MANAGER' LIMIT 1");
    const inserted = await pool.query(
      `INSERT INTO users(first_name, email, password_hash, role_id, is_active)
       VALUES('Catalog test manager', $1, 'not-used', $2, TRUE)
       RETURNING id, auth_version`,
      [`catalog-manager-${Date.now()}@autohub.local`, role.rows[0].id]
    );
    createdManagerId = Number(inserted.rows[0].id);
    authUsers.set("MANAGER", { ...inserted.rows[0], role: "MANAGER" });
  }

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  if (createdManagerId) {
    await pool.query("DELETE FROM users WHERE id = $1", [createdManagerId]);
  }
  await pool.end();
});

test("группы каталога закрыты без авторизации", async () => {
  const response = await fetch(`${baseUrl}/api/admin/catalog/categories`);
  assert.equal(response.status, 401);
});

test("менеджер не может управлять группами каталога", async () => {
  const response = await fetch(`${baseUrl}/api/admin/catalog/categories`, {
    headers: { Cookie: `autohub_token=${tokenFor("MANAGER")}` },
  });
  assert.equal(response.status, 403);
});

test("администратор получает группы каталога", async () => {
  const response = await fetch(`${baseUrl}/api/admin/catalog/categories`, {
    headers: { Cookie: `autohub_token=${tokenFor("ADMIN")}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.categories));
});

test("менеджер навсегда скрывает товар без наличия, сохраняя журнал", async () => {
  const brand = await pool.query(
    "SELECT id FROM brands ORDER BY id LIMIT 1"
  );
  const article = `REMOVE${Date.now()}`;
  const product = await pool.query(
    `
      INSERT INTO products(
        brand_id,
        article,
        article_normalized,
        name
      )
      VALUES($1, $2, $2, 'Remove test product')
      RETURNING id
    `,
    [brand.rows[0].id, article]
  );
  const productId = Number(product.rows[0].id);

  try {
    const response = await fetch(
      `${baseUrl}/api/admin/products/${productId}/permanent`,
      {
        method: "DELETE",
        headers: {
          Cookie: `autohub_token=${tokenFor("MANAGER")}`,
        },
      }
    );

    assert.equal(response.status, 200);

    const state = await pool.query(
      `
        SELECT
          p.is_active,
          EXISTS(
            SELECT 1
            FROM product_removal_log log
            WHERE log.product_id = p.id
          ) AS was_logged
        FROM products p
        WHERE p.id = $1
      `,
      [productId]
    );

    assert.equal(state.rows[0].is_active, false);
    assert.equal(state.rows[0].was_logged, true);
  } finally {
    await pool.query(
      "DELETE FROM product_removal_log WHERE product_id = $1",
      [productId]
    );
    await pool.query(
      "DELETE FROM products WHERE id = $1",
      [productId]
    );
  }
});
