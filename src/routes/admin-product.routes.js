import {
  Router,
} from "express";

import {
  getProductReturnPolicy,
  permanentlyRemoveProduct,
  setProductReturnPolicy,
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

adminProductRouter.get(
  "/:productId/return-policy",
  getProductReturnPolicy
);

adminProductRouter.patch(
  "/:productId/return-policy",
  setProductReturnPolicy
);
