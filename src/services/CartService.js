import { transaction } from "../db/transaction.js";
import { CartRepository } from "../repositories/CartRepository.js";
import { CartAccessRepository } from "../repositories/CartAccessRepository.js";
import { CheckoutRepository } from "../repositories/CheckoutRepository.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import {
  CartAccessService,
} from "./CartAccessService.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { ReturnPolicyService } from "./ReturnPolicyService.js";
import {
  OFFER_AVAILABILITY,
  resolveOfferAvailability,
} from "./OfferService.js";

function createError(
  message,
  statusCode = 400
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizePositiveNumber(
  value,
  label
) {
  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number <= 0
  ) {
    throw createError(
      `${label} має бути більшим за нуль`
    );
  }

  return number;
}

function normalizeItemId(value) {
  const itemId = Number(value);

  if (
    !Number.isInteger(itemId) ||
    itemId <= 0
  ) {
    throw createError(
      "Некоректний itemId"
    );
  }

  return itemId;
}

function publicCart(cart) {
  return {
    id: cart.id,
    userId: cart.user_id,
    status: cart.status,
    createdAt: cart.created_at,
    updatedAt: cart.updated_at,
  };
}

export function presentCartItems(items, pricingContext) {
  return items.map((item) => {
    const quantity =
      Number(item.quantity);

    const pricing = CustomerPricingService.price({ retailPrice: item.retail_price,
      minimumSalePrice: item.minimum_sale_price }, pricingContext);
    const retailPrice = Number(pricing?.customerPrice);
    const returnPolicy = ReturnPolicyService.resolveRow(item);
    const availabilityStatus = resolveOfferAvailability({
      ...item,
      quantity: item.public_available_quantity,
      stock_quantity: item.stock_quantity,
      reserved_quantity: item.reserved_quantity,
      own_reserved_quantity: item.own_reserved_quantity,
    });
    const availableQuantity = Number(item.available_quantity);

    return {
      id: item.id,
      cartId: item.cart_id,
      productOfferId:
        item.product_offer_id,
      productId: item.product_id,
      article: item.article,
      name: item.name,
      quantity,
      availableQuantity:
        availableQuantity,
      retailPrice,
      lineTotal:
        Number(
          (
            quantity * retailPrice
          ).toFixed(2)
        ),
      sourceType:
        item.source_type,
      isAvailable:
        item.is_available === true &&
        item.is_hidden !== true &&
        availableQuantity > 0,
      availabilityStatus:
        Number(item.own_reserved_quantity) > 0
          ? OFFER_AVAILABILITY.RESERVED_FOR_YOU
          : availabilityStatus,
      reservationExpiresAt:
        Number(item.own_reserved_quantity) > 0
          ? item.own_reserved_until || null
          : null,
      returnPolicy,
      isReturnable: ReturnPolicyService.isReturnable(returnPolicy),
      createdAt:
        item.created_at,
      updatedAt:
        item.updated_at,
    };
  });
}

function cartResult(
  cart,
  items,
  cartToken = null,
  pricingContext = null
) {
  const serializedItems =
    presentCartItems(items, pricingContext);

  const totalQuantity =
    serializedItems.reduce(
      (sum, item) =>
        sum + item.quantity,
      0
    );

  const totalAmount =
    serializedItems.reduce(
      (sum, item) =>
        sum + item.lineTotal,
      0
    );

  return {
    cart: publicCart(cart),
    items: serializedItems,
    summary: {
      itemsCount:
        serializedItems.length,
      totalQuantity,
      totalAmount:
        Number(
          totalAmount.toFixed(2)
        ),
    },
    ...(cartToken
      ? { cartToken }
      : {}),
  };
}

async function loadCartResult(
  cart,
  cartToken = null,
  userId = null
) {
  const items =
    await CartRepository.getItems(
      cart.id
    );

  const pricingContext = await CustomerPricingService.getContext(userId);
  return cartResult(
    cart,
    items,
    cartToken,
    pricingContext
  );
}

async function invalidateActiveCheckoutForCart(cartId, db) {
  await CheckoutRepository.expireActiveSessionsForCart(cartId, db);
  await CheckoutRepository.cancelActiveForCart(cartId, db);
  await ReservationRepository.releaseActiveByCartId(cartId, db);
}

async function lockCartForMutation(cartId, db) {
  const locked =
    await CartAccessRepository
      .lockActiveByIdForUpdate(
        cartId,
        db
      );

  if (!locked) {
    throw createError(
      "Кошик більше не активний",
      409
    );
  }
}

export const CartService = {
  async getCurrentCart({ userId }) {
    const access =
      await CartAccessService.getOrCreate({
        userId,
      });

    return loadCartResult(
      access.cart,
      null,
      userId
    );
  },

  async addProduct({
    cartId = null,
    userId = null,
    guestToken = null,
    productOfferId,
    quantity,
  }) {
    const numericQuantity =
      normalizePositiveNumber(
        quantity,
        "Кількість"
      );

    const result = await transaction(async (db) => {
      const access =
        await CartAccessService
          .getOrCreate({
            cartId,
            userId,
            guestToken,
            db,
          });

      const cart = access.cart;

      await lockCartForMutation(
        cart.id,
        db
      );

      await invalidateActiveCheckoutForCart(
        cart.id,
        db
      );

      const offer =
        await ProductRepository
          .findOfferByIdForUpdate(
            productOfferId,
            db
          );

      if (!offer) {
        throw createError(
          "Пропозицію не знайдено",
          404
        );
      }

      if (!offer.isAvailable) {
        throw createError(
          "Товар недоступний"
        );
      }

      const existingItem =
        await CartRepository.findItem(
          cart.id,
          productOfferId,
          db
        );

      const existingQuantity =
        existingItem
          ? Number(existingItem.quantity)
          : 0;

      const finalQuantity =
        existingQuantity +
        numericQuantity;

      const reservedByOthers =
        await ReservationRepository
          .getReservedQuantity(
            offer.id,
            existingItem?.id ?? null,
            db
          );

      const availableQuantity =
        Math.max(
          0,
          Number(offer.quantity) -
            reservedByOthers
        );

      if (
        finalQuantity >
        availableQuantity
      ) {
        throw createError(
          `Недостатньо товару. ` +
          `Доступно: ${availableQuantity}`
        );
      }

      await CartRepository.addItem(
        cart.id,
        productOfferId,
        numericQuantity,
        db
      );

      return {
        cart,
        guestToken: access.guestToken,
      };
    });

    return loadCartResult(
      result.cart,
      result.guestToken,
      userId
    );
  },

  async getCart({
    cartId,
    userId = null,
    guestToken = null,
  }) {
    const cart =
      await CartAccessService
        .assertAccess({
          cartId,
          userId,
          guestToken,
        });

    return loadCartResult(cart, null, userId);
  },

  async updateItemQuantity({
    cartId,
    itemId,
    userId = null,
    guestToken = null,
    quantity,
  }) {
    const normalizedItemId =
      normalizeItemId(itemId);

    const numericQuantity =
      normalizePositiveNumber(
        quantity,
        "Кількість"
      );

    const result = await transaction(async (db) => {
      const cart =
        await CartAccessService
          .assertAccess({
            cartId,
            userId,
            guestToken,
            db,
          });

      await lockCartForMutation(
        cart.id,
        db
      );

      await invalidateActiveCheckoutForCart(
        cart.id,
        db
      );

      const item =
        await CartRepository
          .findItemById(
            cart.id,
            normalizedItemId,
            db
          );

      if (!item) {
        throw createError(
          "Позицію кошика не знайдено",
          404
        );
      }

      const offer =
        await ProductRepository
          .findOfferByIdForUpdate(
            item.product_offer_id,
            db
          );

      if (!offer) {
        throw createError(
          "Пропозицію не знайдено",
          404
        );
      }

      if (!offer.isAvailable) {
        throw createError(
          "Товар зараз недоступний"
        );
      }

      const reservedByOthers =
        await ReservationRepository
          .getReservedQuantity(
            offer.id,
            item.id,
            db
          );

      const availableQuantity =
        Math.max(
          0,
          Number(offer.quantity) -
            reservedByOthers
        );

      if (
        numericQuantity >
        availableQuantity
      ) {
        throw createError(
          `Недостатньо товару. ` +
          `Доступно: ${availableQuantity}`
        );
      }

      const updated =
        await CartRepository
          .setItemQuantity(
            cart.id,
            normalizedItemId,
            numericQuantity,
            db
          );

      if (!updated) {
        throw createError(
          "Позицію кошика не знайдено",
          404
        );
      }

      return { cart };
    });

    return loadCartResult(
      result.cart,
      null,
      userId
    );
  },

  async removeItem({
    cartId,
    itemId,
    userId = null,
    guestToken = null,
  }) {
    const normalizedItemId =
      normalizeItemId(itemId);

    const result = await transaction(async (db) => {
      const cart =
        await CartAccessService
          .assertAccess({
            cartId,
            userId,
            guestToken,
            db,
          });

      await lockCartForMutation(
        cart.id,
        db
      );

      await invalidateActiveCheckoutForCart(
        cart.id,
        db
      );

      const deleted =
        await CartRepository.deleteItem(
          cart.id,
          normalizedItemId,
          db
        );

      if (!deleted) {
        throw createError(
          "Позицію кошика не знайдено",
          404
        );
      }

      return { cart };
    });

    return loadCartResult(
      result.cart,
      null,
      userId
    );
  },
};
