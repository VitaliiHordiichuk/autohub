import {
  Router,
} from "express";

import {
  claimGuestCart,
  getCurrentCart,
} from "../controllers/client-cart.controller.js";

import {
  requireAuth,
} from "../middleware/auth.middleware.js";


export const clientCartRouter =
  Router();

clientCartRouter.get(
  "/",
  requireAuth,
  getCurrentCart
);


clientCartRouter.post(
  "/claim",
  requireAuth,
  claimGuestCart
);
