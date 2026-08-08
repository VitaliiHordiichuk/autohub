import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import { app } from "../../src/app.js";
import { pool } from "../../src/config/db.js";

let server;
let baseUrl;

function tokenFor(role) {
  return jwt.sign(
    { sub: "1", role },
    process.env.AUTH_JWT_SECRET,
    {
      expiresIn: "10m",
      issuer: "autohub-backend",
      audience: "autohub-client",
    }
  );
}

before(async () => {
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
