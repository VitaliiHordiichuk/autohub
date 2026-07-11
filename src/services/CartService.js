import { CartRepository } from "../repositories/CartRepository.js";
import { ProductRepository } from "../repositories/ProductRepository.js";

export const CartService = {
  async addProduct({
    cartId = null,
    userId = null,
    productOfferId,
    quantity,
  }) {
    const numericQuantity = Number(quantity);

    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      throw new Error("Количество должно быть больше нуля");
    }

    let cart = null;

    if (cartId) {
      cart = await CartRepository.findActiveCartById(cartId);
    }

    if (!cart && userId) {
      cart = await CartRepository.findActiveCartByUserId(userId);
    }

    if (!cart) {
      cart = await CartRepository.createCart(userId);
    }

    const offer =
      await ProductRepository.findOfferById(productOfferId);

    if (!offer) {
      throw new Error("Предложение не найдено");
    }

    if (!offer.isAvailable) {
      throw new Error("Товар недоступен");
    }

    const existingItem =
  await CartRepository.findItem(
    cart.id,
    productOfferId
  );

const existingQuantity = existingItem
  ? Number(existingItem.quantity)
  : 0;

const finalQuantity =
  existingQuantity + numericQuantity;

if (finalQuantity > offer.quantity) {
  throw new Error(
    `Недостаточно товара. Доступно: ${offer.quantity}`
  );
}

    await CartRepository.addItem(
      cart.id,
      productOfferId,
      numericQuantity
    );

    const items = await CartRepository.getItems(cart.id);

    return {
      cart,
      items,
    };
  },
};