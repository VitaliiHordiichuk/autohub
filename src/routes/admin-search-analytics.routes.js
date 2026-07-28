import {
  Router,
} from "express";

import {
  getSearchAnalytics,
} from "../controllers/admin-search-analytics.controller.js";


export const adminSearchAnalyticsRouter =
  Router();


adminSearchAnalyticsRouter.get(
  "/",
  getSearchAnalytics
);
