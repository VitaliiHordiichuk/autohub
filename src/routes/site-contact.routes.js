import { Router } from "express";

import {
  getAdminSiteContact,
  getPublicSiteContact,
  updateAdminSiteContact,
} from "../controllers/site-contact.controller.js";

export const siteContactRouter = Router();
export const adminSiteContactRouter = Router();

siteContactRouter.get("/", getPublicSiteContact);
adminSiteContactRouter.get("/", getAdminSiteContact);
adminSiteContactRouter.patch("/", updateAdminSiteContact);
