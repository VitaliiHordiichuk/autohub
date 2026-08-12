import { OrderRepository } from "../../repositories/OrderRepository.js";
import {
  OrderDeliveryRepository,
} from "../../repositories/OrderDeliveryRepository.js";

export const GetManagerOrders = {
  async execute({
    status = null,
    limit = 50,
    offset = 0,
  } = {}) {
    const safeLimit = Math.min(
      Math.max(Number(limit) || 50, 1),
      100
    );

    const safeOffset = Math.max(
      Number(offset) || 0,
      0
    );

    const orders =
      await OrderRepository
        .findAllForManager({
          status,
          limit: safeLimit,
          offset: safeOffset,
        });

    const deliveryRows =
      await OrderDeliveryRepository
        .findByOrderIds(
          orders.map((order) =>
            Number(order.id)
          )
        );

    const deliveryByOrderId =
      new Map(
        deliveryRows.map((delivery) => [
          delivery.orderId,
          delivery,
        ])
      );

    return orders.map((order) => {
      const delivery =
        deliveryByOrderId.get(
          Number(order.id)
        ) ?? null;

      return {
        ...order,
        total_amount:
          Number(order.total_amount),
        total_quantity:
          Number(order.total_quantity),

        delivery: delivery
          ? {
              deliveryMethod:
                delivery.deliveryMethod,
              recipientFirstName:
                delivery.recipientFirstName,
              recipientLastName:
                delivery.recipientLastName,
              recipientMiddleName:
                delivery.recipientMiddleName,
              recipientPhone:
                delivery.recipientPhone,
              cityName:
                delivery.novaPoshta.cityName,
              pointType:
                delivery.novaPoshta.pointType,
              pointName:
                delivery.novaPoshta.pointName,
              pointAddress:
                delivery.novaPoshta.pointAddress,
            }
          : null,
      };
    });
  },
};
