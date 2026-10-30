import { Router } from "express";
import {
  assignCustomerTaxonomySubgroup,
  getCustomerTaxonomyOverview,
  getCustomerTaxonomyProduct,
  getCustomerTaxonomyProducts,
} from "../controllers/admin-customer-taxonomy.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

export const adminCustomerTaxonomyRouter = Router();

adminCustomerTaxonomyRouter.use(requireAuth, requireRole("ADMIN", "MANAGER"));
adminCustomerTaxonomyRouter.get("/", getCustomerTaxonomyOverview);
adminCustomerTaxonomyRouter.get("/tree", getCustomerTaxonomyOverview);
adminCustomerTaxonomyRouter.get("/products", getCustomerTaxonomyProducts);
adminCustomerTaxonomyRouter.get(
  "/categories/:categorySlug/products",
  getCustomerTaxonomyProducts,
);
adminCustomerTaxonomyRouter.get("/products/:productId", getCustomerTaxonomyProduct);
adminCustomerTaxonomyRouter.put(
  "/products/:productId/primary-subgroup",
  requireRole("ADMIN"),
  assignCustomerTaxonomySubgroup,
);
