import { OrderRepository } from "../../repositories/OrderRepository.js";
import {
  OrderDeliveryRepository,
} from "../../repositories/OrderDeliveryRepository.js";
import { OrderReturnRepository } from "../../repositories/OrderReturnRepository.js";

export const GetManagerOrder = {
  async execute(orderId) {
    const numericOrderId =
      Number(orderId);

    if (
      !Number.isInteger(numericOrderId) ||
      numericOrderId <= 0
    ) {
      throw new Error(
        "Некорректный номер заказа"
      );
    }

    const order =
      await OrderRepository
        .findByIdForManager(
          numericOrderId
        );

    if (!order) {
      return null;
    }

    const [
      items,
      statusHistory,
      itemHistory,
      delivery,
      returns,
    ] = await Promise.all([
      OrderRepository
        .findItemsByOrderId(
          numericOrderId
        ),
      OrderRepository
        .findStatusHistory(
          numericOrderId
        ),
      OrderRepository
        .findItemHistory(
          numericOrderId
        ),
      OrderDeliveryRepository
        .findByOrderId(
          numericOrderId
        ),
      OrderReturnRepository.listByOrder(numericOrderId),
    ]);

    return {
      ...order,
      total_amount:
        Number(order.total_amount),

      delivery,

      items: items.map((item) => ({
        ...item,
        quantity:
          Number(item.quantity),
        price_at_purchase:
          Number(
            item.price_at_purchase
          ),

        offer_quantity:
          item.offer_quantity === null
            ? null
            : Number(
                item.offer_quantity
              ),

        purchase_price:
          item.purchase_price === null
            ? null
            : Number(
                item.purchase_price
              ),

        current_retail_price:
          item.current_retail_price ===
          null
            ? null
            : Number(
                item.current_retail_price
              ),

        reserved_quantity:
          item.reserved_quantity === null
            ? null
            : Number(
                item.reserved_quantity
              ),
      })),

      statusHistory,
      itemHistory,
      returns,
    };
  },
};
