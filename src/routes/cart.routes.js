import { Router } from "express";

import {
  addCartItem,
  getCart,
  removeCartItem,
  updateCartItem,
} from "../controllers/cart.controller.js";

import {
  optionalAuth,
} from "../middleware/auth.middleware.js";

export const cartRouter = Router();

cartRouter.use(optionalAuth);

cartRouter.post(
  "/items",
  addCartItem
);

cartRouter.get(
  "/:cartId",
  getCart
);

cartRouter.patch(
  "/:cartId/items/:itemId",
  updateCartItem
);

cartRouter.delete(
  "/:cartId/items/:itemId",
  removeCartItem
);
