import { GetManagerOrders } from "../use-cases/manager/GetManagerOrders.js";
import { GetManagerOrder } from "../use-cases/manager/GetManagerOrder.js";
import { OrderEditingService } from "../services/OrderEditingService.js";

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

export async function changeManagerOrderItemQuantity(req, res) {
  try {
    const {
      quantity,
      changedBy = null,
      reason = null,
    } = req.body;

    const result =
      await OrderEditingService.changeQuantity({
        orderId: req.params.orderId,
        orderItemId: req.params.itemId,
        quantity,
        changedBy,
        reason,
      });

    return res.json({
      success: true,
      message: "Количество позиции изменено",
      order: result.order,
      item: result.item,
      history: result.history,
    });
  } catch (error) {
    console.error("Ошибка изменения количества:", error);

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}
export async function changeManagerOrderItemPrice(req, res) {
  try {
    const {
      price,
      changedBy = null,
      reason = null,
    } = req.body;

    const result =
      await OrderEditingService.changePrice({
        orderId: req.params.orderId,
        orderItemId: req.params.itemId,
        price,
        changedBy,
        reason,
      });

    return res.json({
      success: true,
      message: "Цена позиции изменена",
      order: result.order,
      item: result.item,
      history: result.history,
    });
  } catch (error) {
    console.error("Ошибка изменения цены:", error);

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function removeManagerOrderItem(req, res) {
  try {
    const {
      changedBy = null,
      reason = null,
    } = req.body;

    const result =
      await OrderEditingService.removeItem({
        orderId: req.params.orderId,
        orderItemId: req.params.itemId,
        changedBy,
        reason,
      });

    return res.json({
      success: true,
      message: "Позиция удалена из заказа",
      order: result.order,
      item: result.item,
      history: result.history,
    });

  } catch (error) {
    console.error(
      "Ошибка удаления позиции:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}