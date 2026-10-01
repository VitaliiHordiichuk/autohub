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

import {
  AuthService,
} from "../../src/services/AuthService.js";


let server;
let baseUrl;
let registered;


function authCookie(token) {
  return `autohub_token=${token}`;
}


async function readJson(response) {
  return response.json();
}


before(async () => {
  server = app.listen(0);

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  const suffix =
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  registered = await AuthService.register({
    firstName: "Session",
    lastName: "Test",
    phone: "+380671239876",
    email: `auth-session-${suffix}@autohub.local`,
    password: "SessionPassword42",
  });
});


after(async () => {
  const userId = Number(registered?.user?.id);
  const customerId = Number(registered?.customer?.id);

  if (customerId) {
    await pool.query(
      "DELETE FROM customer_history WHERE customer_id = $1",
      [customerId]
    );
    await pool.query(
      "DELETE FROM customers WHERE id = $1",
      [customerId]
    );
  }

  if (userId) {
    await pool.query(
      "DELETE FROM user_delivery_profiles WHERE user_id = $1",
      [userId]
    );
    await pool.query(
      "DELETE FROM users WHERE id = $1",
      [userId]
    );
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await pool.end();
});


test("guest auth session is a successful unauthenticated state", async () => {
  const response = await fetch(`${baseUrl}/api/auth/session`);
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    authenticated: false,
    user: null,
    customer: null,
  });
});


test("valid auth session returns the current user", async () => {
  const response = await fetch(
    `${baseUrl}/api/auth/session`,
    {
      headers: {
        Cookie: authCookie(registered.token),
      },
    }
  );
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.authenticated, true);
  assert.equal(body.user.id, registered.user.id);
  assert.equal(body.user.email, registered.user.email);
  assert.equal(body.customer.id, registered.customer.id);
});


test("protected current-user endpoint remains protected for guests", async () => {
  const response = await fetch(`${baseUrl}/api/auth/me`);
  const body = await readJson(response);

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
});


test("invalid and expired session cookies become unauthenticated state", async () => {
  const invalidResponse = await fetch(
    `${baseUrl}/api/auth/session`,
    {
      headers: {
        Cookie: authCookie("not-a-valid-session-token"),
      },
    }
  );
  const invalidBody = await readJson(invalidResponse);

  assert.equal(invalidResponse.status, 200);
  assert.equal(invalidBody.authenticated, false);
  assert.equal(invalidBody.user, null);

  const originalVerifySessionToken =
    AuthService.verifySessionToken;
  const expiredError = new Error("jwt expired");
  expiredError.name = "TokenExpiredError";

  AuthService.verifySessionToken = async () => {
    throw expiredError;
  };

  try {
    const expiredResponse = await fetch(
      `${baseUrl}/api/auth/session`,
      {
        headers: {
          Cookie: authCookie(registered.token),
        },
      }
    );
    const expiredBody = await readJson(expiredResponse);

    assert.equal(expiredResponse.status, 200);
    assert.equal(expiredBody.authenticated, false);
    assert.equal(expiredBody.user, null);
  } finally {
    AuthService.verifySessionToken =
      originalVerifySessionToken;
  }
});


test("unexpected session lookup failures remain server errors", async () => {
  const originalVerifySessionToken =
    AuthService.verifySessionToken;

  AuthService.verifySessionToken = async () => {
    throw new Error("simulated database failure");
  };

  try {
    const response = await fetch(
      `${baseUrl}/api/auth/session`,
      {
        headers: {
          Cookie: authCookie(registered.token),
        },
      }
    );

    assert.equal(response.status, 500);
  } finally {
    AuthService.verifySessionToken =
      originalVerifySessionToken;
  }
});
