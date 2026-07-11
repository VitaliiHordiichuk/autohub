import { Router } from "express";

import {
  getManagerOrder,
  getManagerOrders,
} from "../controllers/manager-order.controller.js";

export const managerOrderRouter = Router();

managerOrderRouter.get("/", getManagerOrders);
managerOrderRouter.get("/:orderId", getManagerOrder);