import express from "express";

import {
  testImport,
  uploadImport,
  previewImport
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

export {
  router as adminImportRouter
};