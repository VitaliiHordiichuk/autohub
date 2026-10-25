import { transaction } from "../db/transaction.js";

import { CartRepository } from "../repositories/CartRepository.js";
import { CartAccessRepository } from "../repositories/CartAccessRepository.js";
import { CheckoutRepository } from "../repositories/CheckoutRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import {
  CartAccessService,
} from "./CartAccessService.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import {
  resolveFulfillmentType,
} from "./InventoryClassificationService.js";

function validateCart(cart, items) {
  if (!cart) {
    throw new Error(
      "Активний кошик не знайдено"
    );
  }

  if (!items.length) {
    throw new Error("Кошик порожній");
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
      "Одну або кілька вибраних позицій кошика не знайдено"
    );
    error.statusCode = 400;
    throw error;
  }

  return items;
}

export const CheckoutService = {
  async start({
    cartId,
    itemIds = null,
    userId = null,
    guestToken = null,
    pricingUserId = null, // Verified internal Telegram identity; never from a request body.
  }) {
    if (!cartId) {
      throw new Error("cartId є обов’язковим");
    }

    return transaction(async (db) => {
      const cart =
        await CartAccessService.assertAccess({
          cartId,
          userId,
          guestToken,
          db,
        });

      const lockedCart =
        await CartAccessRepository
          .lockActiveByIdForUpdate(
            cart.id,
            db
          );

      if (!lockedCart) {
        const error = new Error(
          "Кошик більше не активний"
        );
        error.statusCode = 409;
        throw error;
      }

      const allItems =
        await CartRepository.getItems(
          cart.id,
          db
        );

      const items = selectCheckoutItems(allItems, itemIds);

      validateCart(cart, items);

      await CheckoutRepository.expireActiveSessionsForCart(cart.id, db);
      // A customer can still arrive with a checkout opened before this release.
      // Release only its cart hold; order-linked records belong to existing orders.
      await ReservationRepository.releaseActiveByCartId(cart.id, db);
      await CheckoutRepository.cancelActiveForCart(cart.id, db);
      const pricingContext = await CustomerPricingService.getContext(pricingUserId ?? userId, db);
      const checkoutItems = items.map((item) => {
        const pricing = CustomerPricingService.price({
          retailPrice: item.retail_price,
          minimumSalePrice: item.minimum_sale_price,
        }, pricingContext);
        const priceSnapshot = Number(pricing?.customerPrice);
        if (!Number.isFinite(priceSnapshot) || priceSnapshot < 0) {
          const error = new Error(`Не вдалося визначити ціну товару ${item.article}`);
          error.statusCode = 409;
          throw error;
        }
        return {
          cartItemId: Number(item.id),
          productOfferId: Number(item.product_offer_id),
          quantity: Number(item.quantity),
          priceSnapshot,
          fulfillmentType: resolveFulfillmentType(item),
          productName: String(item.name || item.article),
          article: String(item.article),
        };
      });

      const checkoutSession = await CheckoutRepository.createSession({
        cartId: cart.id,
        userId,
        expiresAt: null,
        inventoryModel: "COMMIT_ON_SUBMIT",
      }, db);
      const sessionItems = await CheckoutRepository.replaceSessionItems(
        checkoutSession.id,
        checkoutItems,
        db
      );

      return {
        checkoutSession,
        reservations: [],
        items: sessionItems,
        reused: false,
      };
    });
  },
};
