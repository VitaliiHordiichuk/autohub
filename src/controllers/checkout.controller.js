import { StartCheckout } from "../use-cases/checkout/StartCheckout.js";
import { SubmitOrder } from "../use-cases/checkout/SubmitOrder.js";

export async function startCheckout(req, res) {
  try {
    const {
      cartId,
      userId = null,
    } = req.body;

    const result = await StartCheckout.execute({
      cartId,
      userId,
    });

    return res.status(201).json({
      success: true,
      checkout: result,
    });
  } catch (error) {
    console.error("Ошибка начала оформления:", error);

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function submitOrder(req, res) {
  try {
    const {
      checkoutId,
      customerId = null,
      userId = null,
      comment = null,
    } = req.body;

    const result = await SubmitOrder.execute({
      checkoutId,
      customerId,
      userId,
      comment,
    });

    return res.status(201).json({
      success: true,
      message: "Заказ отправлен менеджеру",
      order: result.order,
      items: result.orderItems,
    });
  } catch (error) {
    console.error("Ошибка отправки заказа:", error);

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}