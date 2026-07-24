import { Router } from "express";

import {
  getDeliveryProfile,
  saveDeliveryProfile,
} from "../controllers/delivery-profile.controller.js";

import {
  requireAuth,
} from "../middleware/auth.middleware.js";

export const deliveryProfileRouter = Router();

deliveryProfileRouter.use(requireAuth);

deliveryProfileRouter.get(
  "/delivery-profile",
  getDeliveryProfile
);

deliveryProfileRouter.put(
  "/delivery-profile",
  saveDeliveryProfile
);
