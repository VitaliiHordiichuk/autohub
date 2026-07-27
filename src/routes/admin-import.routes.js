import express from "express";

import {
  testImport,
  uploadImport,
  previewImport,
  getImportHistory,
  getImportErrors,
}
from "../controllers/admin-import.controller.js";

import { downloadImportErrorsXlsx }
from "../controllers/admin-import-export.controller.js";

import {
  getPendingNewProducts,
  approveNewProduct,
  approveAllNewProducts,
  rejectNewProduct,
  getImportReport,
}
from "../controllers/admin-import-review.controller.js";

import { upload }
from "../config/upload.js";

const router = express.Router();

router.post(
  "/test",
  testImport
);

router.post(
  "/upload",
  upload.single("file"),
  uploadImport
);

router.post(
  "/preview",
  upload.single("file"),
  previewImport
);

router.get(
  "/history",
  getImportHistory
);

router.get(
  "/new-products",
  getPendingNewProducts
);

router.post(
  "/new-products/approve-all",
  approveAllNewProducts
);

router.post(
  "/new-products/:reviewId/approve",
  approveNewProduct
);

router.post(
  "/new-products/:reviewId/reject",
  rejectNewProduct
);

router.get(
  "/:importId/report",
  getImportReport
);

router.get(
  "/:importId/errors.xlsx",
  downloadImportErrorsXlsx
);

router.get(
  "/:importId/errors",
  getImportErrors
);

export {
  router as adminImportRouter,
};
