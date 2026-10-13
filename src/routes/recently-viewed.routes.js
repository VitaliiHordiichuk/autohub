import { Router } from "express";

import {
  clearAccountRecentlyViewed,
  listAccountRecentlyViewed,
  listPublicRecentlyViewed,
  mergeAccountRecentlyViewed,
} from "../controllers/recently-viewed.controller.js";
import {
  optionalAuthSilent,
  requireAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

export const publicRecentlyViewedRouter = Router();
publicRecentlyViewedRouter.post("/", optionalAuthSilent, listPublicRecentlyViewed);

export const accountRecentlyViewedRouter = Router();
accountRecentlyViewedRouter.use(requireAuth, requireRole("CLIENT"));
accountRecentlyViewedRouter.get("/", listAccountRecentlyViewed);
accountRecentlyViewedRouter.put("/", mergeAccountRecentlyViewed);
accountRecentlyViewedRouter.delete("/", clearAccountRecentlyViewed);
