import { Router } from "express";
import { getCatalogTree, getCatalogDirections, getCategoryProducts, getDirectionProducts, getLegacyCatalogRedirect } from "../controllers/catalog.controller.js";
import { optionalAuthSilent } from "../middleware/auth.middleware.js";

export const catalogRouter = Router();
catalogRouter.get("/legacy-redirect/:slug", getLegacyCatalogRedirect);
catalogRouter.get("/categories", getCatalogTree);
catalogRouter.get("/directions", getCatalogDirections);
catalogRouter.get("/directions/:slug/products", optionalAuthSilent, getDirectionProducts);
catalogRouter.get("/categories/:slug/products", optionalAuthSilent, getCategoryProducts);
