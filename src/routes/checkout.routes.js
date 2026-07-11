import { Router } from "express";

import {
  startCheckout,
  submitOrder,
} from "../controllers/checkout.controller.js";

export const checkoutRouter = Router();

checkoutRouter.post("/start", startCheckout);
checkoutRouter.post("/submit", submitOrder);