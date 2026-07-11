import { transaction } from "../../db/transaction.js";

import { CartRepository } from "../../repositories/CartRepository.js";
import { CheckoutRepository } from "../../repositories/CheckoutRepository.js";
import { OrderRepository } from "../../repositories/OrderRepository.js";
import { ReservationRepository } from "../../repositories/ReservationRepository.js";

function calculateTotal(items) {
  return items.reduce((total, item) => {
    return (
      total +
      Number(item.quantity) *
        Number(item.retail_price)
    );
  }, 0);
}

export const SubmitOrder = {
  async execute({
    checkoutId,
    customerId = null,
    userId = null,
    comment = null,
  }) {
    if (!checkoutId) {
      throw new Error("checkoutId обязателен");
    }

    return transaction(async (db) => {
      const checkout =
        await CheckoutRepository.findActiveById(
          checkoutId,
          db
        );

      if (!checkout) {
        throw new Error(
          "Сессия оформления не найдена или срок резерва истёк"
        );
      }

      const cart =
        await CartRepository.findActiveCartById(
          checkout.cart_id,
          db
        );

      if (!cart) {
        throw new Error("Активная корзина не найдена");
      }

      const items =
        await CartRepository.getItems(cart.id, db);

      if (!items.length) {
        throw new Error("Корзина пустая");
      }

      const reservations =
        await ReservationRepository.findActiveByCheckoutSessionId(
          checkout.id,
          db
        );

      if (reservations.length !== items.length) {
        throw new Error(
          "Не все позиции корзины имеют активный резерв"
        );
      }

      const totalAmount = calculateTotal(items);

      const order =
        await OrderRepository.createOrder(
          {
            customerId,
            createdBy: userId,
            comment,
            totalAmount,
          },
          db
        );

      const orderItems = [];

      for (const item of items) {
        const orderItem =
          await OrderRepository.addOrderItem(
            {
              orderId: order.id,
              productId: item.product_id,
              productOfferId:
                item.product_offer_id,
              quantity: Number(item.quantity),
              priceAtPurchase:
                Number(item.retail_price),
            },
            db
          );

        orderItems.push(orderItem);
      }

      await ReservationRepository.attachToOrder(
        checkout.id,
        order.id,
        db
      );

      await CheckoutRepository.markCompleted(
        checkout.id,
        db
      );

      await CartRepository.closeCart(
        cart.id,
        db
      );

      await OrderRepository.addStatusHistory(
        {
          orderId: order.id,
          oldStatus: null,
          newStatus: "NEW",
          changedBy: userId,
          comment:
            "Клиент завершил оформление заказа",
        },
        db
      );

      return {
        order,
        orderItems,
      };
    });
  },
};