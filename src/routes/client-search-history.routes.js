import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getClientSearchHistory } from "../controllers/client-search-history.controller.js";

export const clientSearchHistoryRouter=Router();
clientSearchHistoryRouter.use(requireAuth);
clientSearchHistoryRouter.get("/",getClientSearchHistory);
