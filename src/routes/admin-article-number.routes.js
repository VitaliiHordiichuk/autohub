import { Router } from "express";
import {
  createArticleNumberLink,
  getArticleNumberLinks,
  updateArticleNumberLink,
  previewArticleNumberImport,
  commitArticleNumberImport,
} from "../controllers/admin-article-number.controller.js";
import { upload } from "../config/upload.js";

export const adminArticleNumberRouter = Router();
adminArticleNumberRouter.get("/", getArticleNumberLinks);
adminArticleNumberRouter.post("/", createArticleNumberLink);
adminArticleNumberRouter.patch("/:linkId", updateArticleNumberLink);
adminArticleNumberRouter.post("/import/preview", upload.single("file"), previewArticleNumberImport);
adminArticleNumberRouter.post("/import/commit", upload.single("file"), commitArticleNumberImport);
