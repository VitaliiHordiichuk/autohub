import {
  Router,
} from "express";

import {
  getAutomaticTranslationStatus,
  processAutomaticTranslations,
  retryFailedAutomaticTranslations,
} from "../controllers/admin-automatic-translation.controller.js";


const router = Router();


router.get(
  "/status",
  getAutomaticTranslationStatus
);


router.post(
  "/process",
  processAutomaticTranslations
);


router.post(
  "/retry-failed",
  retryFailedAutomaticTranslations
);


export default router;
