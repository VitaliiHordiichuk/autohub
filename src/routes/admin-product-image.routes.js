import { Router } from "express";
import multer from "multer";
import { deleteProductImage,getProductImages,makePrimaryProductImage,reprocessProductImage,searchImageProducts,setProductImageDisplayMode,uploadProductImages } from "../controllers/admin-product-image.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

const imageUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:8}});
export const adminProductImageRouter=Router();
adminProductImageRouter.use(requireAuth,requireRole("ADMIN"));
adminProductImageRouter.get("/products",searchImageProducts);
adminProductImageRouter.get("/:productId",getProductImages);
adminProductImageRouter.post("/:productId",imageUpload.array("images",8),uploadProductImages);
adminProductImageRouter.patch("/:productId/:imageId/primary",makePrimaryProductImage);
adminProductImageRouter.patch("/:productId/:imageId/display",setProductImageDisplayMode);
adminProductImageRouter.post("/:productId/:imageId/reprocess",reprocessProductImage);
adminProductImageRouter.delete("/:productId/:imageId",deleteProductImage);
