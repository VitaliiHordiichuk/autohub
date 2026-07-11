import { transaction } from "../db/transaction.js";

import { OrderRepository } from "../repositories/OrderRepository.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";


const EDITABLE_ORDER_STATUSES = new Set(["NEW"]);

function validateQuantity(quantity) {
  const numericQuantity = Number(quantity);

  if (
    !Number.isFinite(numericQuantity) ||
    numericQuantity <= 0
  ) {
    throw new Error(
      "Количество должно быть больше нуля"
    );
  }

  return numericQuantity;
}

export const OrderEditingService = {
  async changeQuantity({
    orderId,
    orderItemId,
    quantity,
    changedBy = null,
    reason = null,
  }) {
    const numericOrderId = Number(orderId);
    const numericOrderItemId = Number(orderItemId);
    const newQuantity = validateQuantity(quantity);

    if (
      !Number.isInteger(numericOrderId) ||
      numericOrderId <= 0
    ) {
      throw new Error("Некорректный номер заказа");
    }

    if (
      !Number.isInteger(numericOrderItemId) ||
      numericOrderItemId <= 0
    ) {
      throw new Error("Некорректная позиция заказа");
    }

    return transaction(async (db) => {
      const order =
        await OrderRepository.findByIdForUpdate(
          numericOrderId,
          db
        );

      if (!order) {
        throw new Error("Заказ не найден");
      }

      if (!EDITABLE_ORDER_STATUSES.has(order.status)) {
        throw new Error(
          `Заказ со статусом ${order.status} редактировать нельзя`
        );
      }

      const orderItem =
        await OrderRepository.findItemByIdForUpdate(
          numericOrderId,
          numericOrderItemId,
          db
        );

      if (!orderItem) {
        throw new Error(
          "Позиция заказа не найдена"
        );
      }

      const offer =
        await ProductRepository.findOfferByIdForUpdate(
          orderItem.product_offer_id,
          db
        );

      if (!offer || !offer.isAvailable) {
        throw new Error(
          "Предложение товара недоступно"
        );
      }

      const reservation =
        await ReservationRepository.findByOrderAndOfferForUpdate(
          numericOrderId,
          orderItem.product_offer_id,
          db
        );

      if (!reservation) {
        throw new Error(
          "Резерв позиции заказа не найден"
        );
      }

      const reservedByOthers =
        await ReservationRepository.getReservedQuantity(
          orderItem.product_offer_id,
          reservation.cart_item_id,
          db
        );

      const freeQuantity =
        offer.quantity - reservedByOthers;

      if (newQuantity > freeQuantity) {
        throw new Error(
          `Недостаточно товара. Доступно: ${freeQuantity}`
        );
      }

      const oldQuantity = Number(orderItem.quantity);

      const updatedItem =
        await OrderRepository.updateItemQuantity(
          numericOrderItemId,
          newQuantity,
          db
        );

      await ReservationRepository.updateQuantity(
        reservation.id,
        newQuantity,
        db
      );

      const updatedOrder =
        await OrderRepository.recalculateTotal(
          numericOrderId,
          db
        );

      const history =
        await OrderRepository.addItemHistory(
          {
            orderItemId: numericOrderItemId,
            action: "QUANTITY_CHANGED",
            oldQuantity,
            newQuantity,
            changedBy,
            reason,
          },
          db
        );

      return {
        order: updatedOrder,
        item: updatedItem,
        history,
      };
      
    });
  },
  async changePrice({
  orderId,
  orderItemId,
  price,
  changedBy = null,
  reason = null,
}) {
  const numericOrderId = Number(orderId);
  const numericOrderItemId = Number(orderItemId);
  const newPrice = Number(price);

  if (
    !Number.isInteger(numericOrderId) ||
    numericOrderId <= 0
  ) {
    throw new Error("Некорректный номер заказа");
  }

  if (
    !Number.isInteger(numericOrderItemId) ||
    numericOrderItemId <= 0
  ) {
    throw new Error("Некорректная позиция заказа");
  }

  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    throw new Error("Цена должна быть больше нуля");
  }

  const normalizedPrice = Number(newPrice.toFixed(2));

  return transaction(async (db) => {
    const order =
      await OrderRepository.findByIdForUpdate(
        numericOrderId,
        db
      );

    if (!order) {
      throw new Error("Заказ не найден");
    }

    if (!EDITABLE_ORDER_STATUSES.has(order.status)) {
      throw new Error(
        `Заказ со статусом ${order.status} редактировать нельзя`
      );
    }

    const orderItem =
      await OrderRepository.findItemByIdForUpdate(
        numericOrderId,
        numericOrderItemId,
        db
      );

    if (!orderItem) {
      throw new Error("Позиция заказа не найдена");
    }

    const oldPrice = Number(
      orderItem.price_at_purchase
    );

    const updatedItem =
      await OrderRepository.updateItemPrice(
        numericOrderItemId,
        normalizedPrice,
        db
      );

    const updatedOrder =
      await OrderRepository.recalculateTotal(
        numericOrderId,
        db
      );

    const history =
      await OrderRepository.addItemHistory(
        {
          orderItemId: numericOrderItemId,
          action: "PRICE_CHANGED",
          oldPrice,
          newPrice: normalizedPrice,
          changedBy,
          reason,
        },
        db
      );

    return {
      order: updatedOrder,
      item: updatedItem,
      history,
    };
  });
},
async removeItem({
  orderId,
  orderItemId,
  changedBy = null,
  reason = null,
}) {
  return transaction(async (db) => {

    const order =
      await OrderRepository.findByIdForUpdate(
        orderId,
        db
      );

    if (!order) {
      throw new Error("Заказ не найден");
    }

    if (!EDITABLE_ORDER_STATUSES.has(order.status)) {
      throw new Error(
        `Заказ ${order.status} нельзя редактировать`
      );
    }


    const item =
      await OrderRepository.findItemByIdForUpdate(
        orderId,
        orderItemId,
        db
      );


    if (!item) {
      throw new Error(
        "Позиция заказа не найдена"
      );
    }


    if (item.status === "REMOVED") {
      throw new Error(
        "Позиция уже удалена"
      );
    }


    const updatedItem =
      await OrderRepository.removeItem(
        orderItemId,
        db
      );


    await ReservationRepository.cancelByOrderItem(
      orderItemId,
      db
    );


    const updatedOrder =
      await OrderRepository.recalculateTotal(
        orderId,
        db
      );


    const history =
      await OrderRepository.addItemHistory(
        {
          orderItemId,
          action: "REMOVED",
          oldQuantity: item.quantity,
          oldPrice: item.price_at_purchase,
          changedBy,
          reason,
        },
        db
      );


    return {
      order: updatedOrder,
      item: updatedItem,
      history,
    };

  });
},
async restoreItem({
  orderId,
  orderItemId,
  changedBy = null,
  reason = null,
}) {
  return transaction(async (db) => {

    const order =
      await OrderRepository.findByIdForUpdate(
        orderId,
        db
      );

    if (!order) {
      throw new Error("Заказ не найден");
    }

    if (!EDITABLE_ORDER_STATUSES.has(order.status)) {
      throw new Error(
        `Заказ ${order.status} нельзя редактировать`
      );
    }


    const item =
      await OrderRepository.findItemByIdForUpdate(
        orderId,
        orderItemId,
        db
      );


    if (!item) {
      throw new Error(
        "Позиция заказа не найдена"
      );
    }


    if (item.status !== "REMOVED") {
      throw new Error(
        "Позиция не удалена"
      );
    }


    const updatedItem =
      await OrderRepository.restoreItem(
        orderItemId,
        db
      );


    await ReservationRepository.restoreByOrderItem(
      orderItemId,
      db
    );


    const updatedOrder =
      await OrderRepository.recalculateTotal(
        orderId,
        db
      );


    const history =
      await OrderRepository.addItemHistory(
        {
          orderItemId,
          action: "RESTORED",
          oldQuantity: item.quantity,
          oldPrice: item.price_at_purchase,
          changedBy,
          reason,
        },
        db
      );


    return {
      order: updatedOrder,
      item: updatedItem,
      history,
    };

  });
},
async addItem({
  orderId,
  productId,
  productOfferId,
  quantity,
  priceAtPurchase,
  changedBy = null,
  reason = null,
}) {
  const numericOrderId = Number(orderId);
  const numericProductId = Number(productId);
  const numericOfferId = Number(productOfferId);
  const newQuantity = validateQuantity(quantity);
  const newPrice = Number(priceAtPurchase);

  if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) {
    throw new Error("Некорректный номер заказа");
  }

  if (!Number.isInteger(numericProductId) || numericProductId <= 0) {
    throw new Error("Некорректный товар");
  }

  if (!Number.isInteger(numericOfferId) || numericOfferId <= 0) {
    throw new Error("Некорректное предложение товара");
  }

  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    throw new Error("Цена должна быть больше нуля");
  }


  return transaction(async (db) => {

    const order =
      await OrderRepository.findByIdForUpdate(
        numericOrderId,
        db
      );


    if (!order) {
      throw new Error("Заказ не найден");
    }


    if (!EDITABLE_ORDER_STATUSES.has(order.status)) {
      throw new Error(
        `Заказ со статусом ${order.status} редактировать нельзя`
      );
    }


    const offer =
      await ProductRepository.findOfferByIdForUpdate(
        numericOfferId,
        db
      );


    if (!offer || !offer.isAvailable) {
      throw new Error(
        "Предложение товара недоступно"
      );
    }


    const reservedByOthers =
      await ReservationRepository.getReservedQuantity(
        numericOfferId,
        null,
        db
      );


    const freeQuantity =
      offer.quantity - reservedByOthers;


    if (newQuantity > freeQuantity) {
      throw new Error(
        `Недостаточно товара. Доступно: ${freeQuantity}`
      );
    }


    const existingItem =
  await OrderRepository.findActiveItemByOffer(
    numericOrderId,
    numericOfferId,
    db
  );
 

let item;
let history;


if (existingItem) {

  const oldQuantity = Number(
    existingItem.quantity
  );

  const totalQuantity =
    oldQuantity + newQuantity;


  item =
    await OrderRepository.updateItemQuantity(
      existingItem.id,
      totalQuantity,
      db
    );


  const reservation =
    await ReservationRepository.findByOrderAndOfferForUpdate(
      numericOrderId,
      numericOfferId,
      db
    );


  if (reservation) {
    await ReservationRepository.updateQuantity(
      reservation.id,
      totalQuantity,
      db
    );
  }


  history =
    await OrderRepository.addItemHistory(
      {
        orderItemId: existingItem.id,
        action: "QUANTITY_CHANGED",
        oldQuantity,
        newQuantity: totalQuantity,
        changedBy,
        reason:
          reason ??
          "Менеджер увеличил количество",
      },
      db
    );


} else {

  item =
    await OrderRepository.addManagerOrderItem(
      {
        orderId: numericOrderId,
        productId: numericProductId,
        productOfferId: numericOfferId,
        quantity: newQuantity,
        priceAtPurchase: newPrice,
      },
      db
    );


  await ReservationRepository.createOrderReservation(
    {
      orderId: numericOrderId,
      productId: numericProductId,
      productOfferId: numericOfferId,
      quantity: newQuantity,
    },
    db
  );


  history =
    await OrderRepository.addItemHistory(
      {
        orderItemId: item.id,
        action: "ADDED",
        newQuantity,
        newPrice,
        changedBy,
        reason,
      },
      db
    );
}


    const updatedOrder =
      await OrderRepository.recalculateTotal(
        numericOrderId,
        db
      );


    return {
      order: updatedOrder,
      item,
      history,
    };

  });
},
};