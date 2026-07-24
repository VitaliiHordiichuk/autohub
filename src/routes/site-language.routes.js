import {
  Router,
} from "express";

import {
  getAdminLanguages,
  getPublicLanguages,
  updateAdminLanguage,
} from "../controllers/site-language.controller.js";

export const siteLanguageRouter =
  Router();

export const adminSiteLanguageRouter =
  Router();

siteLanguageRouter.get(
  "/",
  getPublicLanguages
);

adminSiteLanguageRouter.get(
  "/",
  getAdminLanguages
);

adminSiteLanguageRouter.patch(
  "/:code",
  updateAdminLanguage
);
