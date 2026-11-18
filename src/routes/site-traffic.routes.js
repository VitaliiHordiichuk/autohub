import { Router } from "express";
import { optionalSessionAuth } from "../middleware/auth.middleware.js";
import { recordSitePageView } from "../controllers/site-traffic.controller.js";

export const siteTrafficRouter = Router();
siteTrafficRouter.post("/", optionalSessionAuth, recordSitePageView);
