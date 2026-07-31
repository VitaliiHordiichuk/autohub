import { transaction } from "../db/transaction.js";

import { OrderRepository } from "../repositories/OrderRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";

export const OrderConfirmationService = {
  async confirmOrder({
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

      if (order.status !== "NEW") {
        throw new Error(
          `Заказ со статусом ${order.status} подтвердить нельзя`
        );
      }

      const items =
        await OrderRepository.findItemsByOrderId(
          numericOrderId,
          db
        );

      if (items.length === 0) {
        throw new Error(
          "Нельзя подтвердить заказ без позиций"
        );
      }

      const confirmedItems =
        await OrderRepository.confirmPurchasePrices(
          numericOrderId,
          db
        );

      if (confirmedItems.length !== items.length) {
        throw new Error(
          "Не удалось зафиксировать закупочные цены всех позиций"
        );
      }

      const activatedReservations =
        await ReservationRepository.activateByOrder(
          numericOrderId,
          db
        );

      if (activatedReservations.length !== items.length) {
        throw new Error(
          "Не удалось активировать резервы всех позиций"
        );
      }

      const updatedOrder =
        await OrderRepository.updateStatus(
          numericOrderId,
          "CONFIRMED",
          db
        );

      const history =
        await OrderRepository.addStatusHistory(
          {
            orderId: numericOrderId,
            oldStatus: "NEW",
            newStatus: "CONFIRMED",
            changedBy,
            comment:
              comment ??
              "Заказ подтверждён менеджером",
          },
          db
        );

      if (order.created_by) {
        await NotificationRepository.createForUser({
          userId: Number(order.created_by),
          eventKey: `order:${numericOrderId}:status:CONFIRMED`,
          type: "ORDER_CONFIRMED",
          orderId: numericOrderId,
          payload: { orderId: numericOrderId },
        }, db);
      }

      return {
        order: updatedOrder,
        items: confirmedItems,
        reservations: activatedReservations,
        history,
      };
    });
  },
};
