import test, {
  after,
  before,
} from "node:test";

import assert
  from "node:assert/strict";

import {
  app,
} from "../../src/app.js";

import {
  pool,
} from "../../src/config/db.js";


let server;
let baseUrl;


before(async () => {
  server =
    app.listen(0);

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
    (
      resolve,
      reject
    ) => {
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
  "присоединение гостевой корзины требует авторизацию",
  async () => {
    const response =
      await fetch(
        `${baseUrl}/api/account/cart/claim`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "X-Cart-Token":
              "12345678901234567890",
          },

          body:
            JSON.stringify({
              cartId: 1,
            }),
        }
      );

    assert.equal(
      response.status,
      401
    );

    const body =
      await response.json();

    assert.equal(
      body.success,
      false
    );
  }
);
