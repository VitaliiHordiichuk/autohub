import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { createTelegramLink, disconnectTelegram, getTelegramStatus } from "../controllers/telegram-connection.controller.js";

export const telegramConnectionRouter = Router();
telegramConnectionRouter.use(requireAuth, requireRole("ADMIN", "MANAGER"));
telegramConnectionRouter.get("/", getTelegramStatus);
telegramConnectionRouter.post("/link", createTelegramLink);
telegramConnectionRouter.delete("/", disconnectTelegram);
