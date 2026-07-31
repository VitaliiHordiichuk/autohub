import { Router } from "express";
import { getCatalogTree, getCategoryProducts } from "../controllers/catalog.controller.js";
import { optionalAuthSilent } from "../middleware/auth.middleware.js";

export const catalogRouter = Router();
catalogRouter.get("/categories", getCatalogTree);
catalogRouter.get("/categories/:slug/products", optionalAuthSilent, getCategoryProducts);
