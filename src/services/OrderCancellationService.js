import { transaction } from "../db/transaction.js";

import { OrderRepository } from "../repositories/OrderRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";

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

    return transaction(async (db) => {
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

      const cancelledReservations =
        await ReservationRepository.cancelByOrder(
          numericOrderId,
          db
        );

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

      return {
        order: updatedOrder,
        reservations: cancelledReservations,
        history,
      };
    });
  },
};
