import { transaction } from "../db/transaction.js";

import { OrderRepository } from "../repositories/OrderRepository.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { StockMovementRepository } from "../repositories/StockMovementRepository.js";
import { resolveFulfillmentType } from "./InventoryClassificationService.js";


const EDITABLE_ORDER_STATUSES = new Set(["NEW", "CONFIRMED"]);

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

async function adjustCommittedStock({
  order,
  item,
  delta,
  changedBy,
  reason,
  db,
}) {
  if (
    order.inventory_model !== "COMMIT_ON_SUBMIT" ||
    item.fulfillment_type !== "STOCK" ||
    delta === 0
  ) return item;

  let updatedOffer;
  let type;
  if (delta > 0) {
    const reserved = await ReservationRepository.getReservedQuantity(
      item.product_offer_id, null, db
    );
    const offer = await ProductRepository.findOfferByIdForUpdate(
      item.product_offer_id, db
    );
    const available = Math.max(0, Number(offer?.quantity || 0) - reserved);
    if (!offer?.isAvailable || delta > available) {
      throw new Error(`Недостаточно товара. Доступно: ${available}`);
    }
    updatedOffer = await ProductRepository.decreaseQuantityForSale(
      item.product_offer_id, delta, db
    );
    type = "ORDER_EDIT_COMMIT";
  } else {
    updatedOffer = await ProductRepository.increaseQuantityForReturn(
      item.product_offer_id, Math.abs(delta), db
    );
    type = "ORDER_EDIT_RESTORE";
  }
  if (!updatedOffer) throw new Error("Не удалось изменить складской остаток");

  const revision = Number(order.edit_revision || 0) + 1;
  const movement = await StockMovementRepository.createInventoryMovement({
    productId: item.product_id,
    productOfferId: item.product_offer_id,
    orderId: order.id,
    orderItemId: item.id,
    quantity: Math.abs(delta),
    type,
    oldQuantity: Number(updatedOffer.old_quantity),
    newQuantity: Number(updatedOffer.new_quantity),
    operationKey: `order-item:${item.id}:edit:${revision}:${type}`,
    changedBy,
    comment: reason ?? `Изменение позиции заказа №${order.id}`,
  }, db);
  if (!movement) throw new Error("Изменение остатка уже применено");

  const committed = Number(item.inventory_committed_quantity || 0) + delta;
  if (committed < 0) throw new Error("Некорректный учтённый остаток позиции");
  return OrderRepository.updateCommittedQuantity(item.id, committed, db);
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

      if (
        !offer ||
        (order.inventory_model !== "COMMIT_ON_SUBMIT" && !offer.isAvailable)
      ) {
        throw new Error(
          "Предложение товара недоступно"
        );
      }

      const oldQuantity = Number(orderItem.quantity);

      if (order.inventory_model === "COMMIT_ON_SUBMIT") {
        await adjustCommittedStock({
          order,
          item: orderItem,
          delta: newQuantity - oldQuantity,
          changedBy,
          reason,
          db,
        });
        const updatedItem = await OrderRepository.updateItemQuantity(
          numericOrderItemId, newQuantity, db
        );
        await OrderRepository.recalculateTotal(numericOrderId, db);
        const updatedOrder = await OrderRepository.markEditPending(numericOrderId, db);
        const history = await OrderRepository.addItemHistory({
          orderItemId: numericOrderItemId,
          action: "QUANTITY_CHANGED",
          oldQuantity,
          newQuantity,
          changedBy,
          reason,
        }, db);
        return { order: updatedOrder, item: updatedItem, history };
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

      const ownIncludedInReserved =
        reservation.cart_item_id === null
          ? Number(reservation.quantity || 0)
          : 0;
      const freeQuantity =
        offer.quantity - reservedByOthers + ownIncludedInReserved;

      if (newQuantity > freeQuantity) {
        throw new Error(
          `Недостаточно товара. Доступно: ${freeQuantity}`
        );
      }

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

      await OrderRepository.recalculateTotal(
          numericOrderId,
          db
        );
      const updatedOrder = await OrderRepository.markEditPending(numericOrderId, db);

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

    await OrderRepository.recalculateTotal(
        numericOrderId,
        db
      );
    const updatedOrder = await OrderRepository.markEditPending(numericOrderId, db);

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

    if (order.inventory_model === "COMMIT_ON_SUBMIT") {
      await adjustCommittedStock({
        order,
        item,
        delta: -Number(item.inventory_committed_quantity || 0),
        changedBy,
        reason,
        db,
      });
    }


    const updatedItem =
      await OrderRepository.removeItem(
        orderItemId,
        db
      );


    if (order.inventory_model !== "COMMIT_ON_SUBMIT") {
      await ReservationRepository.cancelByOrderItem(orderItemId, db);
    }


    await OrderRepository.recalculateTotal(
        orderId,
        db
      );
    const updatedOrder = await OrderRepository.markEditPending(orderId, db);


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


    if (order.inventory_model === "COMMIT_ON_SUBMIT") {
      await adjustCommittedStock({
        order,
        item,
        delta: Number(item.quantity),
        changedBy,
        reason,
        db,
      });
    }

    const updatedItem =
      await OrderRepository.restoreItem(
        orderItemId,
        db
      );


    if (order.inventory_model !== "COMMIT_ON_SUBMIT") {
      await ReservationRepository.restoreByOrderItem(orderItemId, db);
    }


    await OrderRepository.recalculateTotal(
        orderId,
        db
      );
    const updatedOrder = await OrderRepository.markEditPending(orderId, db);


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
  changedBy = null,
  reason = null,
}) {
  const numericOrderId = Number(orderId);
  const numericProductId = Number(productId);
  const numericOfferId = Number(productOfferId);
  const newQuantity = validateQuantity(quantity);

  if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) {
    throw new Error("Некорректный номер заказа");
  }

  if (!Number.isInteger(numericProductId) || numericProductId <= 0) {
    throw new Error("Некорректный товар");
  }

  if (!Number.isInteger(numericOfferId) || numericOfferId <= 0) {
    throw new Error("Некорректное предложение товара");
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

    if (offer.productId !== numericProductId) {
      throw new Error("Предложение не относится к выбранному товару");
    }

    const pricingContext = await CustomerPricingService.getContext(
      order.created_by || null,
      db
    );
    const calculatedPrice = CustomerPricingService.price({
      retailPrice: offer.retailPrice,
      minimumSalePrice: offer.minimumSalePrice,
    }, pricingContext);
    const newPrice = Number(calculatedPrice?.customerPrice);
    if (!Number.isFinite(newPrice) || newPrice <= 0) {
      throw new Error("Не удалось рассчитать цену клиента");
    }

    if (order.inventory_model === "COMMIT_ON_SUBMIT") {
      const detailedOffer = await ProductRepository.findOfferForCheckoutForUpdate(
        numericOfferId, db
      );
      const fulfillmentType = resolveFulfillmentType(detailedOffer || {});
      if (fulfillmentType !== order.fulfillment_type) {
        throw new Error("Предложение относится к другому типу исполнения заказа");
      }
      const existingItem = await OrderRepository.findActiveItemByOffer(
        numericOrderId, numericOfferId, db
      );
      let item;
      let history;
      if (existingItem) {
        const oldQuantity = Number(existingItem.quantity);
        await adjustCommittedStock({
          order,
          item: existingItem,
          delta: newQuantity,
          changedBy,
          reason,
          db,
        });
        item = await OrderRepository.updateItemQuantity(
          existingItem.id, oldQuantity + newQuantity, db
        );
        history = await OrderRepository.addItemHistory({
          orderItemId: existingItem.id,
          action: "QUANTITY_CHANGED",
          oldQuantity,
          newQuantity: oldQuantity + newQuantity,
          changedBy,
          reason,
        }, db);
      } else {
        item = await OrderRepository.addManagerOrderItem({
          orderId: numericOrderId,
          productId: numericProductId,
          productOfferId: numericOfferId,
          quantity: newQuantity,
          priceAtPurchase: newPrice,
          fulfillmentType,
          inventoryCommittedQuantity: 0,
        }, db);
        item = await adjustCommittedStock({
          order,
          item,
          delta: fulfillmentType === "STOCK" ? newQuantity : 0,
          changedBy,
          reason,
          db,
        });
        history = await OrderRepository.addItemHistory({
          orderItemId: item.id,
          action: "ADDED",
          newQuantity,
          newPrice,
          changedBy,
          reason,
        }, db);
      }
      await OrderRepository.recalculateTotal(numericOrderId, db);
      const updatedOrder = await OrderRepository.markEditPending(numericOrderId, db);
      return { order: updatedOrder, item, history };
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


    await OrderRepository.recalculateTotal(
        numericOrderId,
        db
      );
    const updatedOrder = await OrderRepository.markEditPending(numericOrderId, db);


    return {
      order: updatedOrder,
      item,
      history,
    };

  });
},
};
