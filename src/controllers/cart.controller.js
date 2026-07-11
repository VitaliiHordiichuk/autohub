import { CartService } from "../services/CartService.js";

export async function addCartItem(req, res) {
  try {
    const {
      cartId = null,
      userId = null,
      productOfferId,
      quantity,
    } = req.body;

    if (!productOfferId || quantity === undefined) {
      return res.status(400).json({
        success: false,
        error: "productOfferId и quantity обязательны",
      });
    }

    const result = await CartService.addProduct({
      cartId,
      userId,
      productOfferId,
      quantity,
    });

    return res.status(201).json({
      success: true,
      cart: result.cart,
      items: result.items,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}