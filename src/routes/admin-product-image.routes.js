import { Router } from "express";
import multer from "multer";
import { deleteProductImage,getProductImages,makePrimaryProductImage,searchImageProducts,uploadProductImages } from "../controllers/admin-product-image.controller.js";

const imageUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:8}});
export const adminProductImageRouter=Router();
adminProductImageRouter.get("/products",searchImageProducts);
adminProductImageRouter.get("/:productId",getProductImages);
adminProductImageRouter.post("/:productId",imageUpload.array("images",8),uploadProductImages);
adminProductImageRouter.patch("/:productId/:imageId/primary",makePrimaryProductImage);
adminProductImageRouter.delete("/:productId/:imageId",deleteProductImage);
