import { Router } from "express";

import { getProductPlaceholder } from "../controllers/product-placeholder.controller.js";

export const productPlaceholderRouter = Router();

productPlaceholderRouter.get("/:article/placeholder", getProductPlaceholder);
