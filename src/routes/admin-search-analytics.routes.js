import {
  Router,
} from "express";

import {
  getSearchAnalytics,
} from "../controllers/admin-search-analytics.controller.js";
import { getSiteTraffic } from "../controllers/site-traffic.controller.js";


export const adminSearchAnalyticsRouter =
  Router();


adminSearchAnalyticsRouter.get(
  "/",
  getSearchAnalytics
);
adminSearchAnalyticsRouter.get("/traffic", getSiteTraffic);
