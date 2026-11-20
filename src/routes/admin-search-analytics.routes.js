import {
  Router,
} from "express";

import {
  getSearchAnalytics,
} from "../controllers/admin-search-analytics.controller.js";
import { getSiteTraffic, getSiteVisitEvents } from "../controllers/site-traffic.controller.js";


export const adminSearchAnalyticsRouter =
  Router();


adminSearchAnalyticsRouter.get(
  "/",
  getSearchAnalytics
);
adminSearchAnalyticsRouter.get("/traffic", getSiteTraffic);

adminSearchAnalyticsRouter.get("/traffic/visits/:visitKey", getSiteVisitEvents);
