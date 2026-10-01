import test from "node:test";
import assert from "node:assert/strict";

import { CartAccessService } from "./CartAccessService.js";
import { PublicAvailabilityContextService } from "./PublicAvailabilityContextService.js";

test("authenticated availability context uses only the authenticated user", async () => {
  const context = await PublicAvailabilityContextService.fromRequest({
    auth: { userId: 42 },
    headers: { "x-cart-id": "99", "x-cart-token": "untrusted" },
  });

  assert.deepEqual(context, { userId: 42, cartId: null });
});

test("guest availability context requires a verified cart token", async () => {
  const originalAssertAccess = CartAccessService.assertAccess;
  let received = null;
  CartAccessService.assertAccess = async (value) => {
    received = value;
    return { id: 17 };
  };

  try {
    const context = await PublicAvailabilityContextService.fromRequest({
      headers: { "x-cart-id": "17", "x-cart-token": "secret" },
    });
    assert.deepEqual(context, { userId: null, cartId: 17 });
    assert.deepEqual(received, { cartId: 17, guestToken: "secret" });
  } finally {
    CartAccessService.assertAccess = originalAssertAccess;
  }
});

test("invalid guest credentials fall back to anonymous without leaking cart data", async () => {
  const originalAssertAccess = CartAccessService.assertAccess;
  CartAccessService.assertAccess = async () => {
    throw new Error("not found");
  };

  try {
    const context = await PublicAvailabilityContextService.fromRequest({
      headers: { "x-cart-id": "17", "x-cart-token": "wrong" },
    });
    assert.deepEqual(context, { userId: null, cartId: null });
  } finally {
    CartAccessService.assertAccess = originalAssertAccess;
  }
});
