import { transaction } from "../db/transaction.js";

import { OrderRepository } from "../repositories/OrderRepository.js";

const ALLOWED_TRANSITIONS = {
  CONFIRMED: new Set(["PROCESSING"]),
  PROCESSING: new Set(["READY"]),
};

function validateOrderId(orderId) {
  const numericOrderId = Number(orderId);

  if (
    !Number.isInteger(numericOrderId) ||
    numericOrderId <= 0
  ) {
    throw new Error("Некорректный номер заказа");
  }

  return numericOrderId;
}

export const OrderWorkflowService = {
  async changeStatus({
    orderId,
    newStatus,
    changedBy = null,
    comment = null,
  }) {
    const numericOrderId = validateOrderId(orderId);
    const normalizedStatus = String(
      newStatus ?? ""
    ).trim().toUpperCase();

    if (!normalizedStatus) {
      throw new Error("Новый статус обязателен");
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

      const allowedStatuses =
        ALLOWED_TRANSITIONS[order.status];

      if (
        !allowedStatuses ||
        !allowedStatuses.has(normalizedStatus)
      ) {
        throw new Error(
          `Переход ${order.status} → ${normalizedStatus} запрещён`
        );
      }

      const updatedOrder =
        await OrderRepository.updateStatus(
          numericOrderId,
          normalizedStatus,
          db
        );

      const history =
        await OrderRepository.addStatusHistory(
          {
            orderId: numericOrderId,
            oldStatus: order.status,
            newStatus: normalizedStatus,
            changedBy,
            comment:
              comment ??
              `Статус заказа изменён: ${order.status} → ${normalizedStatus}`,
          },
          db
        );

      return {
        order: updatedOrder,
        history,
      };
    });
  },
};