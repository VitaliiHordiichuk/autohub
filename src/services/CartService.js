import { CartRepository } from "../repositories/CartRepository.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import {
  CartAccessService,
} from "./CartAccessService.js";
import { CustomerPricingService } from "./CustomerPricingService.js";

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

function publicItems(items, pricingContext) {
  return items.map((item) => {
    const quantity =
      Number(item.quantity);

    const pricing = CustomerPricingService.price({ retailPrice: item.retail_price,
      minimumSalePrice: item.minimum_sale_price }, pricingContext);
    const retailPrice = Number(pricing?.customerPrice);

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
        Number(
          item.available_quantity
        ),
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
        Boolean(item.is_available),
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
    publicItems(items, pricingContext);

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

    const access =
      await CartAccessService
        .getOrCreate({
          cartId,
          userId,
          guestToken,
        });

    const cart = access.cart;

    const offer =
      await ProductRepository
        .findOfferById(
          productOfferId
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
        productOfferId
      );

    const existingQuantity =
      existingItem
        ? Number(
            existingItem.quantity
          )
        : 0;

    const finalQuantity =
      existingQuantity +
      numericQuantity;

    if (
      finalQuantity >
      Number(offer.quantity)
    ) {
      throw createError(
        `Недостатньо товару. ` +
        `Доступно: ${offer.quantity}`
      );
    }

    await CartRepository.addItem(
      cart.id,
      productOfferId,
      numericQuantity
    );

    return loadCartResult(
      cart,
      access.guestToken,
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

    const cart =
      await CartAccessService
        .assertAccess({
          cartId,
          userId,
          guestToken,
        });

    const item =
      await CartRepository
        .findItemById(
          cart.id,
          normalizedItemId
        );

    if (!item) {
      throw createError(
        "Позицію кошика не знайдено",
        404
      );
    }

    const offer =
      await ProductRepository
        .findOfferById(
          item.product_offer_id
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

    if (
      numericQuantity >
      Number(offer.quantity)
    ) {
      throw createError(
        `Недостатньо товару. ` +
        `Доступно: ${offer.quantity}`
      );
    }

    await CartRepository
      .setItemQuantity(
        cart.id,
        normalizedItemId,
        numericQuantity
      );

    return loadCartResult(cart, null, userId);
  },

  async removeItem({
    cartId,
    itemId,
    userId = null,
    guestToken = null,
  }) {
    const normalizedItemId =
      normalizeItemId(itemId);

    const cart =
      await CartAccessService
        .assertAccess({
          cartId,
          userId,
          guestToken,
        });

    const deleted =
      await CartRepository.deleteItem(
        cart.id,
        normalizedItemId
      );

    if (!deleted) {
      throw createError(
        "Позицію кошика не знайдено",
        404
      );
    }

    return loadCartResult(cart, null, userId);
  },
};
