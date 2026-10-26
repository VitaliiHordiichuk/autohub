import { Router } from "express";
import { searchForMakatron } from "../controllers/makatron-search-bridge.controller.js";

import { productDetails, searchByArticle, searchByText, searchSuggestions } from "../controllers/search.controller.js";

import {
  optionalAuthSilent,
} from "../middleware/auth.middleware.js";

export const searchRouter = Router();

// Verified server-to-server access only; normal site search remains unchanged.
searchRouter.post("/telegram-shared", searchForMakatron);

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
