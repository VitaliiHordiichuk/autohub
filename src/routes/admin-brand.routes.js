import {
  Router,
} from "express";

import {
  addBrandAlias,
  createBrand,
  deleteBrand,
  deleteBrandAlias,
  getBrand,
  getBrands,
  updateBrand,
  updateBrandAlias,
} from "../controllers/admin-brand.controller.js";


export const adminBrandRouter =
  Router();


adminBrandRouter.get(
  "/",
  getBrands
);


adminBrandRouter.post(
  "/",
  createBrand
);


adminBrandRouter.get(
  "/:brandId",
  getBrand
);


adminBrandRouter.patch(
  "/:brandId",
  updateBrand
);


adminBrandRouter.delete(
  "/:brandId",
  deleteBrand
);


adminBrandRouter.post(
  "/:brandId/aliases",
  addBrandAlias
);


adminBrandRouter.patch(
  "/:brandId/aliases/:aliasId",
  updateBrandAlias
);


adminBrandRouter.delete(
  "/:brandId/aliases/:aliasId",
  deleteBrandAlias
);
