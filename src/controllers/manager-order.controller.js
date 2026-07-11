import { GetManagerOrders } from "../use-cases/manager/GetManagerOrders.js";
import { GetManagerOrder } from "../use-cases/manager/GetManagerOrder.js";

export async function getManagerOrders(req, res) {
  try {
    const orders = await GetManagerOrders.execute({
      status: req.query.status ?? null,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    return res.json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("Ошибка получения заказов:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось получить список заказов",
    });
  }
}

export async function getManagerOrder(req, res) {
  try {
    const order =
      await GetManagerOrder.execute(req.params.orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Заказ не найден",
      });
    }

    return res.json({
      success: true,
      order,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}