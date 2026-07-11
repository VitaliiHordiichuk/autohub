import { Router } from "express";

import {
    addManagerOrderItem,
    cancelManagerOrder,
    changeManagerOrderItemPrice,
  changeManagerOrderItemQuantity,
  confirmManagerOrder,
  removeManagerOrderItem,
  restoreManagerOrderItem,
  getManagerOrder,
  getManagerOrders,
} from "../controllers/manager-order.controller.js";

export const managerOrderRouter = Router();

managerOrderRouter.patch(
  "/:orderId/cancel",
  cancelManagerOrder
);

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
managerOrderRouter.patch(
  "/:orderId/items/:itemId/restore",
  restoreManagerOrderItem
);
managerOrderRouter.patch(
  "/:orderId/confirm",
  confirmManagerOrder
);
managerOrderRouter.get("/:orderId", getManagerOrder);

managerOrderRouter.post(
  "/:orderId/items",
  addManagerOrderItem
);