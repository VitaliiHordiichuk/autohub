import {
  Router,
} from "express";

import {
  claimGuestCart,
} from "../controllers/client-cart.controller.js";

import {
  requireAuth,
} from "../middleware/auth.middleware.js";


export const clientCartRouter =
  Router();


clientCartRouter.post(
  "/claim",
  requireAuth,
  claimGuestCart
);
