import { Router } from "express";

import {
  addManagerOrderItem,
  cancelManagerOrder,
  changeManagerOrderItemPrice,
  changeManagerOrderItemQuantity,
  changeManagerOrderStatus,
  completeManagerOrder,
  confirmManagerOrder,
  removeManagerOrderItem,
  restoreManagerOrderItem,
  getManagerOrder,
  getManagerOrders,
  getManagerOrderSummary,
  updateManagerOrderTracking,
  confirmManagerOrderEdits,
} from "../controllers/manager-order.controller.js";

import {
  requireAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

export const managerOrderRouter =
  Router();

managerOrderRouter.use(
  requireAuth,
  requireRole("ADMIN", "MANAGER")
);

managerOrderRouter.patch(
  "/:orderId/tracking",
  updateManagerOrderTracking
);

managerOrderRouter.patch(
  "/:orderId/confirm-edits",
  confirmManagerOrderEdits
);

managerOrderRouter.patch(
  "/:orderId/cancel",
  cancelManagerOrder
);

managerOrderRouter.get(
  "/",
  getManagerOrders
);

managerOrderRouter.get(
  "/summary",
  getManagerOrderSummary
);

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

managerOrderRouter.patch(
  "/:orderId/status",
  changeManagerOrderStatus
);

managerOrderRouter.patch(
  "/:orderId/complete",
  completeManagerOrder
);

managerOrderRouter.get(
  "/:orderId",
  getManagerOrder
);

managerOrderRouter.post(
  "/:orderId/items",
  addManagerOrderItem
);
