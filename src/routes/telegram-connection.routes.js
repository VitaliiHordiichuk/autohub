import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { createTelegramLink, disconnectTelegram, getTelegramStatus, claimTelegramFromBot } from "../controllers/telegram-connection.controller.js";

export const telegramConnectionRouter = Router();
telegramConnectionRouter.use(requireAuth, requireRole("ADMIN", "MANAGER", "CLIENT"));
telegramConnectionRouter.get("/", getTelegramStatus);
telegramConnectionRouter.post("/link", createTelegramLink);
telegramConnectionRouter.post("/claim-from-bot", requireRole("CLIENT"), claimTelegramFromBot);
telegramConnectionRouter.delete("/", disconnectTelegram);
