import { OrderRepository } from "../../repositories/OrderRepository.js";

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
      await OrderRepository.findAllForManager({
        status,
        limit: safeLimit,
        offset: safeOffset,
      });

    return orders.map((order) => ({
      ...order,
      total_amount: Number(order.total_amount),
      total_quantity: Number(order.total_quantity),
    }));
  },
};