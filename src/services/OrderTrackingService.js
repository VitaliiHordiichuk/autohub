import { transaction } from "../db/transaction.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";
import { TelegramNotificationService } from "./TelegramNotificationService.js";

export const OrderTrackingService = {
  async update({ orderId, trackingNumber, changedBy }) {
    const numericOrderId = Number(orderId);
    const normalized = String(trackingNumber || "").replace(/\D/g, "");
    if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) throw new Error("Некорректный номер заказа");
    if (!/^\d{14}$/.test(normalized)) throw new Error("ТТН Новой почты должна содержать 14 цифр");

    let customerUserId = null;
    const result = await transaction(async (db) => {
      const order = await OrderRepository.findByIdForUpdate(numericOrderId, db);
      if (!order) throw new Error("Заказ не найден");
      if (order.tracking_number === normalized) return { order, changed:false };
      customerUserId = order.created_by ? Number(order.created_by) : null;
      const updated = await db.query(`UPDATE orders SET tracking_number=$2,
        tracking_updated_at=CURRENT_TIMESTAMP, tracking_updated_by=$3, updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 RETURNING *`, [numericOrderId, normalized, changedBy]);
      await db.query(`INSERT INTO order_tracking_history(order_id,old_tracking_number,new_tracking_number,changed_by)
        VALUES($1,$2,$3,$4)`, [numericOrderId, order.tracking_number || null, normalized, changedBy]);
      if (customerUserId) await NotificationRepository.createForUser({
        userId:customerUserId, eventKey:`order:${numericOrderId}:tracking:${normalized}`,
        type:"ORDER_TRACKING_UPDATED", orderId:numericOrderId,
        payload:{orderId:numericOrderId,trackingNumber:normalized},
      }, db);
      return { order:updated.rows[0], changed:true };
    });
    let telegram = { sent:false, reason:customerUserId ? "CUSTOMER_NOT_CONNECTED" : "CUSTOMER_NOT_REGISTERED" };
    if (result.changed && customerUserId) {
      try {
        telegram = await TelegramNotificationService.sendTrackingToUser({
          userId:customerUserId, orderId:numericOrderId, trackingNumber:normalized,
        });
      } catch (error) {
        console.error("Ошибка Telegram-уведомления ТТН:", error.message);
        telegram = { sent:false, reason:"SEND_FAILED" };
      }
    } else if (!result.changed) {
      telegram = { sent:false, reason:"NOT_CHANGED" };
    }
    return { ...result, telegram };
  },
};
