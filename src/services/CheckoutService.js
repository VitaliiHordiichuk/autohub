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

export function selectCheckoutItems(allItems, itemIds = null) {
  if (!Array.isArray(itemIds)) {
    return [...allItems];
  }

  const selectedIds = new Set(
    itemIds.map(Number).filter(Number.isInteger)
  );

  const items = allItems.filter((item) =>
    selectedIds.has(Number(item.id))
  );

  if (items.length !== selectedIds.size) {
    const error = new Error(
      "Одна или несколько выбранных позиций корзины не найдены"
    );
    error.statusCode = 400;
    throw error;
  }

  return items;
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

    const freeQuantity = Math.max(
      0,
      offer.quantity - reservedByOthers
    );

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
    itemIds = null,
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

      const allItems =
        await CartRepository.getItems(
          cart.id,
          db
        );

      const items = selectCheckoutItems(allItems, itemIds);

      validateCart(cart, items);

      await CheckoutRepository
        .expireActiveSessionsForCart(
          cart.id,
          db
        );

      await ReservationRepository.releaseActiveByCartId(cart.id, db);
      await CheckoutRepository.cancelActiveForCart(cart.id, db);

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
