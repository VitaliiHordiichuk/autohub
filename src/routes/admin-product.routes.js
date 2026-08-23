import {
  Router,
} from "express";

import {
  permanentlyRemoveProduct,
} from "../controllers/admin-product.controller.js";

import {
  requireAuth,
  requireRole,
} from "../middleware/auth.middleware.js";


export const adminProductRouter = Router();

adminProductRouter.use(
  requireAuth,
  requireRole("ADMIN", "MANAGER")
);

adminProductRouter.delete(
  "/:productId/permanent",
  permanentlyRemoveProduct
);
