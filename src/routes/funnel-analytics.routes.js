import {
  Router,
} from "express";

import {
  recordFunnelEvent,
} from "../controllers/funnel-analytics.controller.js";

import {
  optionalAuthSilent,
} from "../middleware/auth.middleware.js";


export const funnelAnalyticsRouter =
  Router();

funnelAnalyticsRouter.post(
  "/",
  optionalAuthSilent,
  recordFunnelEvent
);
