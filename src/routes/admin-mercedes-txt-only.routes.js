import { Router } from "express";

import {
  requireMercedesTxtActivationEnabled,
} from "../middleware/mercedes-txt-activation-gate.middleware.js";

import {
  requireAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

import {
  listMercedesTxtAdminRevisions,
  activateMercedesTxtAdminRevision,
} from "../controllers/admin-mercedes-txt.controller.js";

import {
  uploadMercedesTxt,
} from "../controllers/admin-mercedes-txt-upload.controller.js";

import {
  launchMercedesTxtAnalysis,
  getMercedesTxtAnalysis,
} from "../controllers/admin-mercedes-txt-analysis.controller.js";

import {
  launchMercedesTxtStage,
  getMercedesTxtStageStatus,
} from "../controllers/admin-mercedes-txt-production-stage.controller.js";

export const adminMercedesTxtOnlyRouter = Router();

const router = adminMercedesTxtOnlyRouter;

// All Mercedes TXT operations require an authenticated ADMIN.

router.post(
  "/:supplierId/mercedes-txt/upload",
  requireAuth,
  requireRole("ADMIN"),
  uploadMercedesTxt
);

router.post(
  "/:supplierId/mercedes-txt/uploads/:fileId/analyze",
  requireAuth,
  requireRole("ADMIN"),
  launchMercedesTxtAnalysis
);

router.get(
  "/:supplierId/mercedes-txt/uploads/:fileId/analysis",
  requireAuth,
  requireRole("ADMIN"),
  getMercedesTxtAnalysis
);

router.post(
  "/:supplierId/mercedes-txt/uploads/:fileId/stage",
  requireAuth,
  requireRole("ADMIN"),
  launchMercedesTxtStage
);

router.get(
  "/:supplierId/mercedes-txt/uploads/:fileId/stage",
  requireAuth,
  requireRole("ADMIN"),
  getMercedesTxtStageStatus
);

router.get(
  "/:supplierId/mercedes-txt/revisions",
  requireAuth,
  requireRole("ADMIN"),
  listMercedesTxtAdminRevisions
);

router.post(
  "/:supplierId/mercedes-txt/activate",
  requireAuth,
  requireRole("ADMIN"),
  requireMercedesTxtActivationEnabled,
  activateMercedesTxtAdminRevision
);
