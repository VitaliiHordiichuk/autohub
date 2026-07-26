import express from "express";

import {
  testImport,
  uploadImport,
  previewImport,
  getImportErrors
}
from "../controllers/admin-import.controller.js";


import { upload } from "../config/upload.js";


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
  "/:importId/errors",
  getImportErrors
);


export {
  router as adminImportRouter
};