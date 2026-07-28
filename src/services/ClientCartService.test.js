import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeCartQuantity,
  normalizeCartClaimInput,
} from "./ClientCartService.js";


test(
  "объединяет количество корзин в пределах остатка",
  () => {
    assert.equal(
      mergeCartQuantity(
        2,
        4,
        5
      ),
      5
    );

    assert.equal(
      mergeCartQuantity(
        1,
        2,
        10
      ),
      3
    );
  }
);


test(
  "проверяет данные присоединения гостевой корзины",
  () => {
    const input =
      normalizeCartClaimInput({
        userId: "7",
        cartId: "11",
        guestToken:
          "12345678901234567890",
      });

    assert.deepEqual(
      input,
      {
        userId: 7,
        cartId: 11,
        guestToken:
          "12345678901234567890",
      }
    );

    assert.throws(
      () =>
        normalizeCartClaimInput({
          userId: 7,
          cartId: 0,
          guestToken:
            "короткий",
        }),
      /cartId/
    );
  }
);
