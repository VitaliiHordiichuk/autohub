import {
  Router,
} from "express";

import {
  listProductTranslations,
  saveProductTranslation,
} from "../controllers/product-translation.controller.js";


export const productTranslationRouter =
  Router();


productTranslationRouter.get(
  "/:productId/translations",
  listProductTranslations
);


productTranslationRouter.put(
  "/:productId/translations/:languageCode",
  saveProductTranslation
);
