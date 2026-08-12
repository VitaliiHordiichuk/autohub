import { Router } from "express";
import multer from "multer";

import {
  createHomepageBanner,
  createHomepageFeature,
  deleteHomepageBanner,
  deleteHomepageFeature,
  getPublicHomepage,
  listHomepageBanners,
  listHomepageFeatures,
  updateHomepageBanner,
  updateHomepageFeature,
} from "../controllers/homepage-content.controller.js";

const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 3 },
});

export const publicHomepageRouter = Router();
publicHomepageRouter.get("/", getPublicHomepage);

export const adminHomepageRouter = Router();
adminHomepageRouter.get("/banners", listHomepageBanners);
adminHomepageRouter.post(
  "/banners",
  bannerUpload.fields([
    { name: "desktopImage", maxCount: 1 },
    { name: "tabletImage", maxCount: 1 },
    { name: "mobileImage", maxCount: 1 },
  ]),
  (req, res, next) => {
    req.files = Object.values(req.files || {}).flat();
    next();
  },
  createHomepageBanner
);
adminHomepageRouter.patch(
  "/banners/:bannerId",
  bannerUpload.fields([
    { name: "desktopImage", maxCount: 1 },
    { name: "tabletImage", maxCount: 1 },
    { name: "mobileImage", maxCount: 1 },
  ]),
  (req, res, next) => {
    req.files = Object.values(req.files || {}).flat();
    next();
  },
  updateHomepageBanner
);
adminHomepageRouter.delete("/banners/:bannerId", deleteHomepageBanner);

adminHomepageRouter.get("/features", listHomepageFeatures);
adminHomepageRouter.post("/features", createHomepageFeature);
adminHomepageRouter.patch("/features/:featureId", updateHomepageFeature);
adminHomepageRouter.delete("/features/:featureId", deleteHomepageFeature);
