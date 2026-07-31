import { StartCheckout } from "../use-cases/checkout/StartCheckout.js";
import { SubmitOrder } from "../use-cases/checkout/SubmitOrder.js";

function guestTokenFromRequest(req) {
  const token = req.get("X-Cart-Token");

  return token ? token.trim() : null;
}

function sendError(res, error, label) {
  console.error(label, error);

  return res
    .status(error.statusCode || 400)
    .json({
      success: false,
      error: error.message,
    });
}

export async function startCheckout(
  req,
  res
) {
  try {
    const {
      cartId,
      itemIds = null,
    } = req.body;

    const result =
      await StartCheckout.execute({
        cartId,
        itemIds,
        userId:
          req.auth?.userId ?? null,
        guestToken:
          guestTokenFromRequest(req),
      });

    return res.status(201).json({
      success: true,
      checkout: result,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      "Ошибка начала оформления:"
    );
  }
}

export async function submitOrder(
  req,
  res
) {
  try {
    const {
      checkoutId,
      comment = null,
      delivery = null,
      saveDeliveryProfile = false,
    } = req.body;

    const result =
      await SubmitOrder.execute({
        checkoutId,
        userId:
          req.auth?.userId ?? null,
        guestToken:
          guestTokenFromRequest(req),
        comment,
        delivery,
        saveDeliveryProfile:
          Boolean(saveDeliveryProfile),
      });

    return res.status(201).json({
      success: true,
      message:
        "Заказ отправлен менеджеру",
      order: result.order,
      items: result.orderItems,
      delivery: result.delivery,
      remainingItemsCount: result.remainingItemsCount,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      "Ошибка отправки заказа:"
    );
  }
}
