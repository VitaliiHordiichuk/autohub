import assert from "node:assert/strict";
import test from "node:test";
import {
  reprocessProductImage,
  uploadProductImages,
} from "./admin-product-image.controller.js";
import { ProductImageService } from "../services/ProductImageService.js";

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
}

test("admin image endpoints pass the selected branding mode to processing", async (t) => {
  const originalUpload = ProductImageService.upload;
  const originalReprocess = ProductImageService.reprocess;
  t.after(() => {
    ProductImageService.upload = originalUpload;
    ProductImageService.reprocess = originalReprocess;
  });

  const calls = [];
  ProductImageService.upload = async (...args) => { calls.push(["upload", ...args]); return []; };
  ProductImageService.reprocess = async (...args) => { calls.push(["reprocess", ...args]); return []; };

  const uploadResponse = response();
  await uploadProductImages({
    params: { productId: "41" },
    files: [{ originalname: "part.jpg" }],
    body: { brandingMode: "STAMP_ONLY" },
  }, uploadResponse);

  const reprocessResponse = response();
  await reprocessProductImage({
    params: { productId: "41", imageId: "9" },
    body: { brandingMode: "CLEAN" },
  }, reprocessResponse);

  assert.deepEqual(calls, [
    ["upload", "41", [{ originalname: "part.jpg" }], "STAMP_ONLY"],
    ["reprocess", "41", "9", "CLEAN"],
  ]);
  assert.equal(uploadResponse.statusCode, 201);
  assert.equal(reprocessResponse.statusCode, 202);
});
