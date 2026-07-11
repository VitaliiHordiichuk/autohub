import { Router } from "express";

import { searchByArticle } from "../controllers/search.controller.js";

export const searchRouter = Router();

searchRouter.get("/", searchByArticle);