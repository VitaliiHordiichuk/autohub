import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  createCatalogCategory,
  getCatalogCategories,
  getCatalogProducts,
  updateProductCatalogCategory,
} from "../controllers/admin-catalog-category.controller.js";

export const adminCatalogCategoryRouter = Router();

adminCatalogCategoryRouter.use(requireAuth, requireRole("ADMIN"));
adminCatalogCategoryRouter.get("/categories", getCatalogCategories);
adminCatalogCategoryRouter.post("/categories", createCatalogCategory);
adminCatalogCategoryRouter.get("/products", getCatalogProducts);
adminCatalogCategoryRouter.put("/products/:productId/category", updateProductCatalogCategory);
