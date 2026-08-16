import { Router } from "express";
import { getSeoBrand, getSeoProduct, getSeoSitemap } from "../controllers/seo.controller.js";

export const seoRouter = Router();

seoRouter.get("/sitemap", getSeoSitemap);
seoRouter.get("/products/:article", getSeoProduct);
seoRouter.get("/brands/:slug", getSeoBrand);
