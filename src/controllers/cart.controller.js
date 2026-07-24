import { CartService } from "../services/CartService.js";

function guestTokenFromRequest(req) {
  const token = req.get("X-Cart-Token");

  return token ? token.trim() : null;
}

function sendError(res, error) {
  return res
    .status(error.statusCode || 400)
    .json({
      success: false,
      error: error.message,
    });
}

export async function addCartItem(req, res) {
  try {
    const {
      cartId = null,
      productOfferId,
      quantity,
    } = req.body;

    if (
      !productOfferId ||
      quantity === undefined
    ) {
      return res.status(400).json({
        success: false,
        error:
          "productOfferId и quantity обязательны",
      });
    }

    const result =
      await CartService.addProduct({
        cartId,
        userId:
          req.auth?.userId ?? null,
        guestToken:
          guestTokenFromRequest(req),
        productOfferId,
        quantity,
      });

    return res.status(201).json({
      success: true,
      ...result,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getCart(req, res) {
  try {
    const result =
      await CartService.getCart({
        cartId: req.params.cartId,
        userId:
          req.auth?.userId ?? null,
        guestToken:
          guestTokenFromRequest(req),
      });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function updateCartItem(
  req,
  res
) {
  try {
    const {
      quantity,
    } = req.body;

    if (quantity === undefined) {
      return res.status(400).json({
        success: false,
        error: "quantity обязателен",
      });
    }

    const result =
      await CartService.updateItemQuantity({
        cartId: req.params.cartId,
        itemId: req.params.itemId,
        userId:
          req.auth?.userId ?? null,
        guestToken:
          guestTokenFromRequest(req),
        quantity,
      });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function removeCartItem(
  req,
  res
) {
  try {
    const result =
      await CartService.removeItem({
        cartId: req.params.cartId,
        itemId: req.params.itemId,
        userId:
          req.auth?.userId ?? null,
        guestToken:
          guestTokenFromRequest(req),
      });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
