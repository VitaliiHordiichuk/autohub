import { transaction } from "../db/transaction.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";
import { TelegramNotificationService } from "./TelegramNotificationService.js";

const EDITABLE_STATUSES = new Set(["NEW", "CONFIRMED"]);

export const OrderEditConfirmationService = {
  async confirm({ orderId, changedBy }) {
    const numericOrderId = Number(orderId);
    if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) {
      throw new Error("Некорректный номер заказа");
    }

    let customerUserId = null;
    const result = await transaction(async (db) => {
      const order = await OrderRepository.findByIdForUpdate(numericOrderId, db);
      if (!order) throw new Error("Заказ не найден");
      if (!EDITABLE_STATUSES.has(order.status)) {
        throw new Error("Этот заказ уже нельзя редактировать");
      }
      if (Number(order.edit_revision) <= Number(order.notified_edit_revision)) {
        throw new Error("Новых изменений для подтверждения нет");
      }

      const updated = await OrderRepository.confirmPendingEdits(numericOrderId, changedBy, db);
      customerUserId = Number(order.created_by || 0) || null;
      if (customerUserId) {
        await NotificationRepository.createForUser({
          userId:customerUserId,
          eventKey:`order:${numericOrderId}:updated:${updated.notified_edit_revision}`,
          type:"ORDER_UPDATED",
          orderId:numericOrderId,
          payload:{orderId:numericOrderId,revision:Number(updated.notified_edit_revision)},
        }, db);
      }
      return updated;
    });

    if (customerUserId) {
      void TelegramNotificationService.sendOrderUpdatedToUser({
        userId:customerUserId,
        orderId:numericOrderId,
      }).catch((error)=>console.error("Ошибка Telegram-уведомления об изменении заказа:", error.message));
    }
    return result;
  },
};
