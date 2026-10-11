import { transaction } from "../db/transaction.js";

import { OrderRepository } from "../repositories/OrderRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { StockMovementRepository } from "../repositories/StockMovementRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";
import { TelegramNotificationService } from "./TelegramNotificationService.js";

const CANCELLABLE_STATUSES = new Set([
  "NEW",
  "CONFIRMED",
  "PROCESSING",
  "READY",
]);

export const OrderCancellationService = {
  async cancelOrder({
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

    let customerUserId = null;
    const result = await transaction(async (db) => {
      const order =
        await OrderRepository.findByIdForUpdate(
          numericOrderId,
          db
        );

      if (!order) {
        throw new Error("Заказ не найден");
      }

      if (!CANCELLABLE_STATUSES.has(order.status)) {
        throw new Error(
          `Заказ со статусом ${order.status} отменить нельзя`
        );
      }

      const oldStatus = order.status;

      let cancelledReservations = [];
      const movements = [];
      if (order.inventory_model === "COMMIT_ON_SUBMIT") {
        const items = await OrderRepository.findItemsByOrderId(numericOrderId, db);
        for (const item of items) {
          const committed = Number(item.inventory_committed_quantity || 0);
          if (item.fulfillment_type !== "STOCK" || committed <= 0) continue;
          const updatedOffer = await ProductRepository.increaseQuantityForReturn(
            item.product_offer_id, committed, db
          );
          if (!updatedOffer) throw new Error(`Не удалось вернуть остаток ${item.article}`);
          const movement = await StockMovementRepository.createInventoryMovement({
            productId: item.product_id,
            productOfferId: item.product_offer_id,
            orderId: numericOrderId,
            orderItemId: item.id,
            quantity: committed,
            type: "ORDER_CANCEL_RESTORE",
            oldQuantity: Number(updatedOffer.old_quantity),
            newQuantity: Number(updatedOffer.new_quantity),
            operationKey: `order-item:${item.id}:cancel-restore`,
            changedBy,
            comment: comment ?? `Возврат остатка при отмене заказа №${numericOrderId}`,
          }, db);
          if (!movement) throw new Error("Остаток позиции уже был возвращён");
          await OrderRepository.updateCommittedQuantity(item.id, 0, db);
          movements.push(movement);
        }
      } else {
        cancelledReservations = await ReservationRepository.cancelByOrder(
          numericOrderId, db
        );
      }

      const updatedOrder =
        await OrderRepository.updateStatus(
          numericOrderId,
          "CANCELLED",
          db
        );

      const history =
        await OrderRepository.addStatusHistory(
          {
            orderId: numericOrderId,
            oldStatus,
            newStatus: "CANCELLED",
            changedBy,
            comment:
              comment ??
              "Заказ отменён менеджером",
          },
          db
        );

      if (order.created_by) {
        customerUserId = Number(order.created_by);
        await NotificationRepository.createForUser({
          userId: Number(order.created_by),
          eventKey: `order:${numericOrderId}:status:CANCELLED`,
          type: "ORDER_CANCELLED",
          orderId: numericOrderId,
          payload: { orderId: numericOrderId },
        }, db);
      }

      return {
        order: updatedOrder,
        reservations: cancelledReservations,
        movements,
        history,
      };
    });

    void TelegramNotificationService.sendOrderStatusToUser({
      userId: customerUserId,
      orderId: numericOrderId,
      status: "CANCELLED",
    }).catch((error) => console.error("Ошибка Telegram-уведомления клиента:", error.message));

    return result;
  },
};
