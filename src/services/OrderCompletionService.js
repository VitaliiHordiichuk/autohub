import { transaction } from "../db/transaction.js";

import { OrderRepository } from "../repositories/OrderRepository.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { StockMovementRepository } from "../repositories/StockMovementRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";

export const OrderCompletionService = {
  async completeOrder({
    orderId,
    changedBy = null,
    comment = null,
  }) {
    const numericOrderId = Number(orderId);

    if (
      !Number.isInteger(numericOrderId) ||
      numericOrderId <= 0
    ) {
      throw new Error("Некорректный номер заказа");
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

      const completableStatuses = new Set([
        "CONFIRMED",
        "PROCESSING",
        "READY",
      ]);

      if (!completableStatuses.has(order.status)) {
        throw new Error(
          `Заказ со статусом ${order.status} завершить нельзя`
        );
      }

      const items =
        await OrderRepository.findItemsByOrderId(
          numericOrderId,
          db
        );

      if (items.length === 0) {
        throw new Error(
          "Нельзя завершить заказ без позиций"
        );
      }

      const movements = [];

      for (const item of items) {
        const soldQuantity = Number(item.quantity);

        const updatedOffer =
          await ProductRepository.decreaseQuantityForSale(
            item.product_offer_id,
            soldQuantity,
            db
          );

        if (!updatedOffer) {
          throw new Error(
            `Недостаточно остатка для позиции ${item.article}`
          );
        }

        const movement =
          await StockMovementRepository.createSaleMovement(
            {
              productId: item.product_id,
              productOfferId: item.product_offer_id,
              orderId: numericOrderId,
              orderItemId: item.id,
              quantity: soldQuantity,
              oldQuantity: Number(
                updatedOffer.old_quantity
              ),
              newQuantity: Number(
                updatedOffer.new_quantity
              ),
              changedBy,
              comment:
                comment ??
                `Продажа по заказу №${numericOrderId}`,
            },
            db
          );

        movements.push(movement);
      }

      const consumedReservations =
        await ReservationRepository.consumeByOrder(
          numericOrderId,
          db
        );

      if (consumedReservations.length !== items.length) {
        throw new Error(
          "Не удалось закрыть резервы всех позиций заказа"
        );
      }

      const updatedOrder =
        await OrderRepository.updateStatus(
          numericOrderId,
          "COMPLETED",
          db
        );

      const history =
        await OrderRepository.addStatusHistory(
          {
            orderId: numericOrderId,
            oldStatus: order.status,
            newStatus: "COMPLETED",
            changedBy,
            comment:
              comment ??
              "Заказ выдан клиенту и завершён",
          },
          db
        );

      if (order.created_by) {
        await NotificationRepository.createForUser({
          userId: Number(order.created_by),
          eventKey: `order:${numericOrderId}:status:COMPLETED`,
          type: "ORDER_COMPLETED",
          orderId: numericOrderId,
          payload: { orderId: numericOrderId },
        }, db);
      }

      return {
        order: updatedOrder,
        items,
        movements,
        reservations: consumedReservations,
        history,
      };
    });
  },
};
