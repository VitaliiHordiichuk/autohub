import { Router } from "express";
import { optionalSessionAuth } from "../middleware/auth.middleware.js";
import {
  createSpecialOrderInquiryHandler,
} from "../controllers/special-order-inquiry.controller.js";

export const specialOrderInquiryRouter = Router();

specialOrderInquiryRouter.post(
  "/",
  optionalSessionAuth,
  createSpecialOrderInquiryHandler
);
