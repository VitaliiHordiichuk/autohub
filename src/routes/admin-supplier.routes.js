import { Router } from "express";

import {
  createSupplier,
  getSuppliers,
  getSupplier,
  getSupplierDetails,
  getSupplierArticleSearchRules,
  updateSupplierArticleSearchRule,
  updateSupplier,
  setSupplierActive,
} from "../controllers/admin-supplier.controller.js";


export const adminSupplierRouter = Router();



adminSupplierRouter.post(
  "/",
  createSupplier
);



adminSupplierRouter.get(
  "/",
  getSuppliers
);

adminSupplierRouter.get(
  "/:supplierId/details",
  getSupplierDetails
);

adminSupplierRouter.get(
  "/:supplierId/article-search-rules",
  getSupplierArticleSearchRules
);


adminSupplierRouter.put(
  "/:supplierId/article-search-rules/:ruleCode",
  updateSupplierArticleSearchRule
);


adminSupplierRouter.get(
  "/:supplierId",
  getSupplier
);



adminSupplierRouter.patch(
  "/:supplierId",
  updateSupplier
);



adminSupplierRouter.patch(
  "/:supplierId/active",
  setSupplierActive
);