import { transaction } from "../db/transaction.js";

import { CartRepository } from "../repositories/CartRepository.js";
import { CheckoutRepository } from "../repositories/CheckoutRepository.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import {
  CartAccessService,
} from "./CartAccessService.js";

const CHECKOUT_RESERVATION_MINUTES = 5;

function createExpirationDate() {
  const expiresAt = new Date();

  expiresAt.setMinutes(
    expiresAt.getMinutes() +
      CHECKOUT_RESERVATION_MINUTES
  );

  return expiresAt;
}

function validateCart(cart, items) {
  if (!cart) {
    throw new Error(
      "Активная корзина не найдена"
    );
  }

  if (!items.length) {
    throw new Error("Корзина пустая");
  }
}

async function lockAndValidateItems(
  items,
  db
) {
  const sortedItems = [...items].sort(
    (a, b) =>
      a.product_offer_id -
      b.product_offer_id
  );

  const validatedItems = [];

  for (const item of sortedItems) {
    const offer =
      await ProductRepository
        .findOfferByIdForUpdate(
          item.product_offer_id,
          db
        );

    if (!offer || !offer.isAvailable) {
      throw new Error(
        `Товар ${item.article} сейчас недоступен`
      );
    }

    const reservedByOthers =
      await ReservationRepository
        .getReservedQuantity(
          item.product_offer_id,
          item.id,
          db
        );

    const freeQuantity =
      offer.quantity - reservedByOthers;

    const requestedQuantity =
      Number(item.quantity);

    if (
      requestedQuantity > freeQuantity
    ) {
      throw new Error(
        `Недостаточно товара ${item.article}. ` +
        `Доступно: ${freeQuantity}`
      );
    }

    validatedItems.push({
      cartItem: item,
      offer,
      requestedQuantity,
      freeQuantity,
    });
  }

  return validatedItems;
}

export const CheckoutService = {
  async start({
    cartId,
    userId = null,
    guestToken = null,
  }) {
    if (!cartId) {
      throw new Error("cartId обязателен");
    }

    return transaction(async (db) => {
      const cart =
        await CartAccessService.assertAccess({
          cartId,
          userId,
          guestToken,
          db,
        });

      const items =
        await CartRepository.getItems(
          cart.id,
          db
        );

      validateCart(cart, items);

      await CheckoutRepository
        .expireActiveSessionsForCart(
          cart.id,
          db
        );

      const existingSession =
        await CheckoutRepository
          .findActiveByCartId(
            cart.id,
            db
          );

      if (existingSession) {
        return {
          checkoutSession:
            existingSession,
          reused: true,
        };
      }

      const validatedItems =
        await lockAndValidateItems(
          items,
          db
        );

      const expiresAt =
        createExpirationDate();

      const checkoutSession =
        await CheckoutRepository
          .createSession(
            {
              cartId: cart.id,
              userId,
              expiresAt,
            },
            db
          );

      const reservations = [];

      for (
        const item of validatedItems
      ) {
        const reservation =
          await ReservationRepository
            .upsertCartReservation(
              {
                cartId: cart.id,
                cartItemId:
                  item.cartItem.id,
                checkoutSessionId:
                  checkoutSession.id,
                productOfferId:
                  item.cartItem
                    .product_offer_id,
                quantity:
                  item.requestedQuantity,
                reservedUntil:
                  expiresAt,
              },
              db
            );

        reservations.push(
          reservation
        );
      }

      return {
        checkoutSession,
        reservations,
        reused: false,
      };
    });
  },
};
