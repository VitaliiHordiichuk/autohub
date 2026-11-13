import { Router } from "express";
import { specialOrderInquiriesEnabled } from "../services/SpecialOrderInquiryFeature.js";
import {
  requireAuth,
  requireRole,
} from "../middleware/auth.middleware.js";
import {
  specialOrderManagerHandlers,
} from "../controllers/special-order-inquiry-manager.controller.js";

export const specialOrderInquiryManagerRouter = Router();

specialOrderInquiryManagerRouter.use(
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  (req, res, next) => specialOrderInquiriesEnabled() ? next() : res.status(503).json({
    success: false, code: "SPECIAL_ORDER_DISABLED",
  })
);

specialOrderInquiryManagerRouter.get(
  "/",
  specialOrderManagerHandlers.list
);

specialOrderInquiryManagerRouter.patch(
  "/:id",
  specialOrderManagerHandlers.update
);
