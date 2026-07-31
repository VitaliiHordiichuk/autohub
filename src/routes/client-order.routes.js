import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getClientOrder,
  getClientOrders,
  repeatClientOrder,
} from "../controllers/client-order.controller.js";

export const clientOrderRouter = Router();

clientOrderRouter.use(requireAuth);
clientOrderRouter.get("/", getClientOrders);
clientOrderRouter.get("/:orderId", getClientOrder);
clientOrderRouter.post("/:orderId/repeat", repeatClientOrder);
