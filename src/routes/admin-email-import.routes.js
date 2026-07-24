import { Router } from "express";

import {
  getEmailImportStatus,
  processEmailNow,
} from "../controllers/admin-email-import.controller.js";


const router = Router();


router.get(
  "/status",
  getEmailImportStatus
);


router.post(
  "/process",
  processEmailNow
);


export default router;
