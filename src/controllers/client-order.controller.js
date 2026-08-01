import { OrderRepository } from "../repositories/OrderRepository.js";
import { OrderDeliveryRepository } from "../repositories/OrderDeliveryRepository.js";
import { CartService } from "../services/CartService.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { OrderReturnRepository } from "../repositories/OrderReturnRepository.js";

function normalizeItem(item) {
  return {
    id: Number(item.id),
    article: item.article,
    name: item.name,
    quantity: Number(item.quantity),
    price: Number(item.price_at_purchase),
    amount: Number(item.quantity) * Number(item.price_at_purchase),
  };
}

export async function getClientOrders(req, res) {
  try {
    const rows = await OrderRepository.findAllForCustomerUser(req.auth.userId);
    return res.json({
      success: true,
      orders: rows.map((order) => ({
        ...order,
        id: Number(order.id),
        total_amount: Number(order.total_amount),
        items_count: Number(order.items_count),
        total_quantity: Number(order.total_quantity),
      })),
    });
  } catch (error) {
    console.error("Ошибка получения заказов клиента:", error);
    return res.status(500).json({ success: false, error: "Не удалось получить заказы" });
  }
}

export async function getClientOrder(req, res) {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ success: false, error: "Некорректный номер заказа" });
  }

  try {
    const order = await OrderRepository.findByIdForCustomerUser(
      orderId,
      req.auth.userId
    );

    if (!order) {
      return res.status(404).json({ success: false, error: "Заказ не найден" });
    }

    const [items, statusHistory, delivery, returns] = await Promise.all([
      OrderRepository.findItemsByOrderId(orderId),
      OrderRepository.findStatusHistory(orderId),
      OrderDeliveryRepository.findByOrderId(orderId),
      OrderReturnRepository.listByOrder(orderId),
    ]);

    return res.json({
      success: true,
      order: {
        ...order,
        id: Number(order.id),
        total_amount: Number(order.total_amount),
        items: items.map(normalizeItem),
        delivery,
        statusHistory: statusHistory.map((entry) => ({
          id: Number(entry.id),
          old_status: entry.old_status,
          new_status: entry.new_status,
          created_at: entry.created_at,
        })),
        returns,
      },
    });
  } catch (error) {
    console.error("Ошибка получения заказа клиента:", error);
    return res.status(500).json({ success: false, error: "Не удалось получить заказ" });
  }
}

export async function repeatClientOrder(req, res) {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ success: false, error: "Некорректный номер заказа" });
  }

  try {
    const order = await OrderRepository.findByIdForCustomerUser(
      orderId,
      req.auth.userId
    );
    if (!order) {
      return res.status(404).json({ success: false, error: "Заказ не найден" });
    }

    const items = await OrderRepository.findItemsByOrderId(orderId);
    const acceptAvailable = req.body?.acceptAvailable === true;

    const availability = await Promise.all(items.map(async (item) => {
      const requested = Number(item.quantity);
      const reserved = item.is_available === true
        ? await ReservationRepository.getReservedQuantity(item.product_offer_id)
        : 0;
      const available = item.is_available === true
        ? Math.max(0, (Number(item.offer_quantity) || 0) - reserved)
        : 0;
      return {
        item,
        article: item.article,
        requested,
        available,
        quantityToAdd: Math.min(requested, available),
      };
    }));

    const adjustments = availability
      .filter((row) => row.available > 0 && row.available < row.requested)
      .map(({ article, requested, available }) => ({ article, requested, available }));

    const unavailable = availability
      .filter((row) => row.available <= 0)
      .map(({ article, requested }) => ({ article, requested, available: 0 }));

    if (adjustments.length > 0 && !acceptAvailable) {
      return res.status(409).json({
        success: false,
        code: "QUANTITY_ADJUSTMENT_REQUIRED",
        adjustments,
        unavailable,
      });
    }

    if (availability.every((row) => row.quantityToAdd <= 0)) {
      return res.status(409).json({
        success: false,
        code: "OUT_OF_STOCK",
        unavailable,
      });
    }

    let cartId = null;
    let cartResult = null;
    const added = [];
    const skipped = [];

    for (const row of availability) {
      const { item, quantityToAdd } = row;

      if (quantityToAdd <= 0) {
        skipped.push({
          article: item.article,
          code: "OUT_OF_STOCK",
        });
        continue;
      }

      try {
        cartResult = await CartService.addProduct({
          cartId,
          userId: req.auth.userId,
          productOfferId: item.product_offer_id,
          quantity: acceptAvailable
            ? quantityToAdd
            : Number(item.quantity),
        });
        cartId = Number(cartResult.cart.id);
        added.push({
          article: item.article,
          quantity: acceptAvailable
            ? quantityToAdd
            : Number(item.quantity),
        });
      } catch (error) {
        skipped.push({
          article: item.article,
          code: "CART_LIMIT",
        });
      }
    }

    if (!cartResult) {
      return res.status(409).json({
        success: false,
        code: "OUT_OF_STOCK",
        skipped,
      });
    }

    return res.json({
      success: true,
      ...cartResult,
      added,
      skipped,
    });
  } catch (error) {
    console.error("Ошибка повторения заказа:", error);
    return res.status(500).json({ success: false, error: "Не удалось повторить заказ" });
  }
}
