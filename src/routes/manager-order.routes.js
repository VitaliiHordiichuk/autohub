import { Router } from "express";

import {
    changeManagerOrderItemPrice,
  changeManagerOrderItemQuantity,
  removeManagerOrderItem,
  getManagerOrder,
  getManagerOrders,
} from "../controllers/manager-order.controller.js";

export const managerOrderRouter = Router();

managerOrderRouter.get("/", getManagerOrders);

managerOrderRouter.patch(
  "/:orderId/items/:itemId/quantity",
  changeManagerOrderItemQuantity
);


managerOrderRouter.patch(
  "/:orderId/items/:itemId/price",
  changeManagerOrderItemPrice
);
managerOrderRouter.patch(
  "/:orderId/items/:itemId/remove",
  removeManagerOrderItem
);
managerOrderRouter.get("/:orderId", getManagerOrder);