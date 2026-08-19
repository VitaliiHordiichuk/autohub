import { Router } from "express";

import {
  changePassword,
  forgotPassword,
  login,
  logout,
  me,
  register,
  resetPassword,
  updateProfile,
} from "../controllers/auth.controller.js";

import {
  requireAuth,
} from "../middleware/auth.middleware.js";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/logout", logout);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);
authRouter.get("/me", requireAuth, me);
authRouter.post("/change-password", requireAuth, changePassword);
authRouter.patch("/profile", requireAuth, updateProfile);
