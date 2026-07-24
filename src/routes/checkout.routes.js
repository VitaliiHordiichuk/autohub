import { Router } from "express";

import {
  startCheckout,
  submitOrder,
} from "../controllers/checkout.controller.js";

import {
  optionalAuth,
} from "../middleware/auth.middleware.js";

export const checkoutRouter = Router();

checkoutRouter.use(optionalAuth);

checkoutRouter.post(
  "/start",
  startCheckout
);

checkoutRouter.post(
  "/submit",
  submitOrder
);
