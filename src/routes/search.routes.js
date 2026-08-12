import { Router } from "express";

import { searchByArticle, searchSuggestions } from "../controllers/search.controller.js";

import {
  optionalAuthSilent,
} from "../middleware/auth.middleware.js";

export const searchRouter = Router();

searchRouter.get(
  "/suggestions",
  optionalAuthSilent,
  searchSuggestions
);

searchRouter.get(
  "/",
  optionalAuthSilent,
  searchByArticle
);
