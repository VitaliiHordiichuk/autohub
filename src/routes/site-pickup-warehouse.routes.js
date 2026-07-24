import { Router } from "express";

import {
  listPickupWarehouses,
} from "../controllers/site-pickup-warehouse.controller.js";

export const sitePickupWarehouseRouter =
  Router();

sitePickupWarehouseRouter.get(
  "/",
  listPickupWarehouses
);
