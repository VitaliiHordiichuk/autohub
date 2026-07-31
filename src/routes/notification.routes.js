import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getNotifications, getNotificationSummary, markAllNotificationsRead } from "../controllers/notification.controller.js";

export const notificationRouter = Router();
notificationRouter.use(requireAuth);
notificationRouter.get("/", getNotifications);
notificationRouter.get("/summary", getNotificationSummary);
notificationRouter.patch("/read-all", markAllNotificationsRead);
