import crypto from "node:crypto";

import {
  CartAccessRepository,
} from "../repositories/CartAccessRepository.js";

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeCartId(value) {
  const cartId = Number(value);

  if (!Number.isInteger(cartId) || cartId <= 0) {
    throw createError("Некоректний cartId");
  }

  return cartId;
}

function createGuestToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashGuestToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token))
    .digest("hex");
}

export const CartAccessService = {
  async getOrCreate({
    cartId = null,
    userId = null,
    guestToken = null,
    db,
  }) {
    if (cartId) {
      const cart = await this.assertAccess({
        cartId,
        userId,
        guestToken,
        db,
      });

      return {
        cart,
        guestToken: null,
      };
    }

    if (userId) {
      let cart =
        await CartAccessRepository
          .findActiveByUserId(userId, db);

      if (!cart) {
        cart =
          await CartAccessRepository
            .createForUser(userId, db);
      }

      return {
        cart,
        guestToken: null,
      };
    }

    const newGuestToken = createGuestToken();
    const guestTokenHash =
      hashGuestToken(newGuestToken);

    const cart =
      await CartAccessRepository.createForGuest(
        guestTokenHash,
        db
      );

    return {
      cart,
      guestToken: newGuestToken,
    };
  },

  async assertAccess({
    cartId,
    userId = null,
    guestToken = null,
    db,
  }) {
    const normalizedCartId =
      normalizeCartId(cartId);

    if (userId) {
      const cart =
        await CartAccessRepository
          .findActiveByIdAndUserId(
            normalizedCartId,
            userId,
            db
          );

      if (!cart) {
        throw createError(
          "Кошик не знайдено або немає доступу",
          404
        );
      }

      return cart;
    }

    if (!guestToken) {
      throw createError(
        "Для гостьового кошика потрібен X-Cart-Token",
        401
      );
    }

    const cart =
      await CartAccessRepository
        .findActiveGuestByIdAndTokenHash(
          normalizedCartId,
          hashGuestToken(guestToken),
          db
        );

    if (!cart) {
      throw createError(
        "Кошик не знайдено або немає доступу",
        404
      );
    }

    return cart;
  },
};
