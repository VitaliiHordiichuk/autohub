import { transaction } from "../../db/transaction.js";

import { CartRepository } from "../../repositories/CartRepository.js";
import { CheckoutRepository } from "../../repositories/CheckoutRepository.js";
import { CustomerRepository } from "../../repositories/CustomerRepository.js";
import { OrderRepository } from "../../repositories/OrderRepository.js";
import { OrderDeliveryRepository } from "../../repositories/OrderDeliveryRepository.js";
import { ReservationRepository } from "../../repositories/ReservationRepository.js";
import { UserDeliveryProfileRepository } from "../../repositories/UserDeliveryProfileRepository.js";

import {
  CartAccessService,
} from "../../services/CartAccessService.js";

import {
  deliveryInputFromProfileRow,
  normalizeOrderDelivery,
} from "../../services/OrderDeliveryService.js";
import { CustomerPricingService } from "../../services/CustomerPricingService.js";

function calculateTotal(items) {
  return items.reduce(
    (total, item) => {
      return (
        total +
        Number(item.quantity) *
          Number(item.retail_price)
      );
    },
    0
  );
}

export function selectReservedCartItems(allItems, reservations) {
  const reservedCartItemIds = new Set(
    reservations.map((reservation) => Number(reservation.cart_item_id))
  );

  return allItems.filter((item) =>
    reservedCartItemIds.has(Number(item.id))
  );
}

export function cartHasRemainingItems(allItems, orderedItems) {
  return allItems.length > orderedItems.length;
}

async function resolveDelivery({
  delivery,
  userId,
  db,
}) {
  if (delivery) {
    return normalizeOrderDelivery(
      delivery
    );
  }

  if (!userId) {
    throw new Error(
      "Гостю необходимо указать данные получения"
    );
  }

  const profileRow =
    await UserDeliveryProfileRepository
      .findByUserId(userId, db);

  if (!profileRow) {
    throw new Error(
      "Профиль доставки не найден"
    );
  }

  return normalizeOrderDelivery(
    deliveryInputFromProfileRow(
      profileRow
    )
  );
}

export const SubmitOrder = {
  async execute({
    checkoutId,
    userId = null,
    guestToken = null,
    comment = null,
    delivery = null,
    saveDeliveryProfile = false,
  }) {
    if (!checkoutId) {
      throw new Error(
        "checkoutId обязателен"
      );
    }

    return transaction(async (db) => {
      const checkout =
        await CheckoutRepository
          .findActiveById(
            checkoutId,
            db
          );

      if (!checkout) {
        throw new Error(
          "Сессия оформления не найдена или срок резерва истёк"
        );
      }

      const cart =
        await CartAccessService
          .assertAccess({
            cartId:
              checkout.cart_id,
            userId,
            guestToken,
            db,
          });

      const allItems =
        await CartRepository.getItems(
          cart.id,
          db
        );

      const reservations =
        await ReservationRepository
          .findActiveByCheckoutSessionId(
            checkout.id,
            db
          );

      const items = selectReservedCartItems(allItems, reservations);

      if (!items.length) {
        throw new Error("В оформлении нет выбранных товаров");
      }

      const pricingContext = await CustomerPricingService.getContext(userId, db);
      for (const item of items) {
        const pricing = CustomerPricingService.price({ retailPrice: item.retail_price,
          minimumSalePrice: item.minimum_sale_price }, pricingContext);
        item.retail_price = pricing?.customerPrice;
      }

      if (
        reservations.length !==
        items.length
      ) {
        throw new Error(
          "Не все позиции корзины имеют активный резерв"
        );
      }

      let customer = null;

      if (userId) {
        customer =
          await CustomerRepository
            .findActiveByUserId(
              userId,
              db
            );

      }

      const customerUserId =
        customer ? userId : null;

      const normalizedDelivery =
        await resolveDelivery({
          delivery,
          userId,
          db,
        });

      const totalAmount =
        calculateTotal(items);

      const order =
        await OrderRepository
          .createOrder(
            {
              customerId:
                customer?.id ?? null,
              createdBy:
                customerUserId,
              comment,
              totalAmount,
            },
            db
          );

      const orderItems = [];

      for (const item of items) {
        const orderItem =
          await OrderRepository
            .addOrderItem(
              {
                orderId: order.id,
                productId:
                  item.product_id,
                productOfferId:
                  item.product_offer_id,
                quantity:
                  Number(item.quantity),
                priceAtPurchase:
                  Number(
                    item.retail_price
                  ),
              },
              db
            );

        orderItems.push(orderItem);
      }

      const orderDelivery =
        await OrderDeliveryRepository
          .create(
            {
              orderId: order.id,
              delivery:
                normalizedDelivery,
            },
            db
          );

      if (
        customerUserId &&
        saveDeliveryProfile &&
        delivery
      ) {
        await UserDeliveryProfileRepository
          .upsert(
            {
              userId,
              ...normalizedDelivery,
            },
            db
          );
      }

      await ReservationRepository
        .attachToOrder(
          checkout.id,
          order.id,
          db
        );

      await ReservationRepository.detachCartItems(checkout.id, db);
      await CartRepository.deleteItems(
        cart.id,
        items.map((item) => item.id),
        db
      );

      await CheckoutRepository
        .markCompleted(
          checkout.id,
          db
        );

      if (!cartHasRemainingItems(allItems, items)) {
        await CartRepository.closeCart(cart.id, db);
      }

      await OrderRepository
        .addStatusHistory(
          {
            orderId: order.id,
            oldStatus: null,
            newStatus: "NEW",
            changedBy:
              customerUserId,
            comment:
              "Клиент завершил оформление заказа",
          },
          db
        );

      return {
        order,
        orderItems,
        delivery: orderDelivery,
        remainingItemsCount: allItems.length - items.length,
      };
    });
  },
};
