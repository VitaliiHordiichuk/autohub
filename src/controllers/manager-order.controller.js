import { GetManagerOrders } from "../use-cases/manager/GetManagerOrders.js";
import { GetManagerOrder } from "../use-cases/manager/GetManagerOrder.js";
import { OrderEditingService } from "../services/OrderEditingService.js";
import { OrderConfirmationService } from "../services/OrderConfirmationService.js";
import { OrderCancellationService } from "../services/OrderCancellationService.js";
import { OrderWorkflowService } from "../services/OrderWorkflowService.js";
import { OrderCompletionService } from "../services/OrderCompletionService.js";

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

export async function restoreManagerOrderItem(req, res) {
  try {
    const {
      changedBy = null,
      reason = null,
    } = req.body;

    const result =
      await OrderEditingService.restoreItem({
        orderId: req.params.orderId,
        orderItemId: req.params.itemId,
        changedBy,
        reason,
      });

    return res.json({
      success: true,
      message: "Позиция восстановлена",
      order: result.order,
      item: result.item,
      history: result.history,
    });

  } catch (error) {
    console.error(
      "Ошибка восстановления позиции:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function addManagerOrderItem(req, res) {
  try {
    const {
      productId,
      productOfferId,
      quantity,
      priceAtPurchase,
      changedBy = null,
      reason = null,
    } = req.body;

    const result =
      await OrderEditingService.addItem({
        orderId: req.params.orderId,
        productId,
        productOfferId,
        quantity,
        priceAtPurchase,
        changedBy,
        reason,
      });

    return res.status(201).json({
      success: true,
      message: "Позиция добавлена в заказ",
      order: result.order,
      item: result.item,
      history: result.history,
    });
  } catch (error) {
    console.error("Ошибка добавления позиции:", error);

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}
export async function confirmManagerOrder(req, res) {
  try {
    const {
      changedBy = null,
      comment = null,
    } = req.body;

    const result =
      await OrderConfirmationService.confirmOrder({
        orderId: req.params.orderId,
        changedBy,
        comment,
      });

    return res.json({
      success: true,
      message: "Заказ подтверждён менеджером",
      order: result.order,
      items: result.items,
      reservations: result.reservations,
      history: result.history,
    });
  } catch (error) {
    console.error("Ошибка подтверждения заказа:", error);

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}
export async function cancelManagerOrder(req, res) {
  try {
    const {
      changedBy = null,
      comment = null,
    } = req.body;

    const result =
      await OrderCancellationService.cancelOrder({
        orderId: req.params.orderId,
        changedBy,
        comment,
      });

    return res.json({
      success: true,
      message: "Заказ отменён менеджером",
      order: result.order,
      reservations: result.reservations,
      history: result.history,
    });
  } catch (error) {
    console.error("Ошибка отмены заказа:", error);

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}
export async function changeManagerOrderStatus(req, res) {
  try {
    const {
      newStatus,
      changedBy = null,
      comment = null,
    } = req.body;

    const result =
      await OrderWorkflowService.changeStatus({
        orderId: req.params.orderId,
        newStatus,
        changedBy,
        comment,
      });

    return res.json({
      success: true,
      message: "Статус заказа изменён",
      order: result.order,
      history: result.history,
    });
  } catch (error) {
    console.error(
      "Ошибка изменения статуса заказа:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}
export async function completeManagerOrder(req, res) {
  try {
    const {
      changedBy = null,
      comment = null,
    } = req.body;

    const result =
      await OrderCompletionService.completeOrder({
        orderId: req.params.orderId,
        changedBy,
        comment,
      });

    return res.json({
      success: true,
      message: "Заказ завершён",
      order: result.order,
      items: result.items,
      movements: result.movements,
      reservations: result.reservations,
      history: result.history,
    });
  } catch (error) {
    console.error(
      "Ошибка завершения заказа:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}