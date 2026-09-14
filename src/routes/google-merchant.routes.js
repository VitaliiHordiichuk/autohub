import { Router } from "express";
import { getGoogleMerchantFeed } from "../controllers/google-merchant.controller.js";


export const googleMerchantRouter = Router();

googleMerchantRouter.get(
  "/merchant-feed.xml",
  getGoogleMerchantFeed
);
