import express from "express";

import {
  getWarehouseImportProfile,
  saveWarehouseImportProfile,
}
from "../controllers/warehouse-import-profile.controller.js";

import {
  getWarehouseImportSettings,
  createWarehouseImportSettings,
  updateWarehouseImportSettings,
}
from "../controllers/warehouse-import-settings.controller.js";


const router = express.Router();



router.get(
  "/warehouses/:warehouseId/import-settings",
  getWarehouseImportSettings
);



router.post(
  "/warehouses/:warehouseId/import-settings",
  createWarehouseImportSettings
);



router.patch(
  "/warehouses/:warehouseId/import-settings",
  updateWarehouseImportSettings
);



router.get(
  "/warehouses/:warehouseId/import-profile",
  getWarehouseImportProfile
);

router.put(
  "/warehouses/:warehouseId/import-profile",
  saveWarehouseImportProfile
);


export { router as adminImportSettingsRouter };