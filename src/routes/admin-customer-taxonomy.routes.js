import { Router } from "express";
import {
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
