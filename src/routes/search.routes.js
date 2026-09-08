import { Router } from "express";

import { productDetails, searchByArticle, searchByText, searchSuggestions } from "../controllers/search.controller.js";

import {
  optionalAuthSilent,
} from "../middleware/auth.middleware.js";

export const searchRouter = Router();

searchRouter.get("/product", optionalAuthSilent, productDetails);
searchRouter.get("/text", optionalAuthSilent, searchByText);

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
