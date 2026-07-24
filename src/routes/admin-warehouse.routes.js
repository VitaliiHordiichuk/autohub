import { Router } from "express";

import {
  createWarehouse,
  getWarehouse,
  getWarehouses,
  setWarehouseActive,
  updateWarehouse,
} from "../controllers/admin-warehouse.controller.js";

export const adminWarehouseRouter = Router();

adminWarehouseRouter.post(
  "/",
  createWarehouse
);

adminWarehouseRouter.get(
  "/",
  getWarehouses
);

adminWarehouseRouter.get(
  "/:warehouseId",
  getWarehouse
);

adminWarehouseRouter.patch(
  "/:warehouseId",
  updateWarehouse
);

adminWarehouseRouter.patch(
  "/:warehouseId/active",
  setWarehouseActive
);