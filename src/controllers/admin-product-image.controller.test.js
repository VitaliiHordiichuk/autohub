import assert from "node:assert/strict";
import test from "node:test";
import {
  previewExistingProductImage,
  previewProductImageUpload,
  replaceProductImage,
  reprocessProductImage,
  uploadProductImages,
} from "./admin-product-image.controller.js";
import { ProductImageService } from "../services/ProductImageService.js";
import { adminProductImageRouter } from "../routes/admin-product-image.routes.js";

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
}

test("admin image endpoints pass the selected processing settings to the service", async (t) => {
  const originalUpload = ProductImageService.upload;
  const originalReprocess = ProductImageService.reprocess;
  const originalPreviewUpload = ProductImageService.previewUpload;
  const originalPreviewExisting = ProductImageService.previewExisting;
  t.after(() => {
    ProductImageService.upload = originalUpload;
    ProductImageService.reprocess = originalReprocess;
    ProductImageService.previewUpload = originalPreviewUpload;
    ProductImageService.previewExisting = originalPreviewExisting;
  });

  const calls = [];
  ProductImageService.upload = async (...args) => { calls.push(["upload", ...args]); return []; };
  ProductImageService.reprocess = async (...args) => { calls.push(["reprocess", ...args]); return []; };
  ProductImageService.previewUpload = async (...args) => { calls.push(["previewUpload", ...args]); return { preview: "data:image/webp;base64,test" }; };
  ProductImageService.previewExisting = async (...args) => { calls.push(["previewExisting", ...args]); return { preview: "data:image/webp;base64,test" }; };

  const uploadResponse = response();
  await uploadProductImages({
    params: { productId: "41" },
    files: [{ originalname: "part.jpg" }],
    body: { brandingMode: "STAMP_ONLY", processingMode: "LEGACY" },
  }, uploadResponse);

  const reprocessResponse = response();
  await reprocessProductImage({
    params: { productId: "41", imageId: "9" },
    body: { processingMode: "SMART_SAFE", cropPaddingRatio: 0.08 },
  }, reprocessResponse);

  const uploadPreviewResponse = response();
  const file = { originalname: "part.jpg" };
  await previewProductImageUpload({
    params: { productId: "41" },
    file,
    body: { processingMode: "SMART_SAFE" },
  }, uploadPreviewResponse);

  const existingPreviewResponse = response();
  await previewExistingProductImage({
    params: { productId: "41", imageId: "9" },
    body: { processingMode: "PRODUCT_FOCUS", crop: { left: 0, top: 0, width: 1, height: 1 } },
  }, existingPreviewResponse);

  assert.deepEqual(calls, [
    ["upload", "41", [{ originalname: "part.jpg" }], { brandingMode: "STAMP_ONLY", processingMode: "LEGACY" }],
    ["reprocess", "41", "9", { processingMode: "SMART_SAFE", cropPaddingRatio: 0.08 }],
    ["previewUpload", "41", file, { processingMode: "SMART_SAFE" }],
    ["previewExisting", "41", "9", { processingMode: "PRODUCT_FOCUS", crop: { left: 0, top: 0, width: 1, height: 1 } }],
  ]);
  assert.equal(uploadResponse.statusCode, 201);
  assert.equal(reprocessResponse.statusCode, 202);
  assert.equal(uploadPreviewResponse.payload.success, true);
  assert.equal(existingPreviewResponse.payload.success, true);
});

test("smart preview and publication routes remain behind the ADMIN-only router gate", () => {
  const stack = adminProductImageRouter.stack;
  const authIndex = stack.findIndex((layer) => layer.name === "requireAuth" && !layer.route);
  const roleIndex = stack.findIndex((layer) => layer.name === "roleMiddleware" && !layer.route);
  assert.ok(authIndex >= 0);
  assert.equal(roleIndex, authIndex + 1);

  for (const path of [
    "/:productId/preview",
    "/:productId/:imageId/preview",
    "/:productId/:imageId/reprocess",
    "/:productId/:imageId/replace",
  ]) {
    const routeIndex = stack.findIndex((layer) => layer.route?.path === path);
    assert.ok(routeIndex > roleIndex, `${path} must be registered after the admin gate`);
  }

  const roleGate = stack[roleIndex].handle;
  let statusCode = null;
  let nextCalls = 0;
  const response = {
    status(code) { statusCode = code; return this; },
    json() { return this; },
  };
  roleGate({ auth: { role: "MANAGER" } }, response, () => { nextCalls += 1; });
  assert.equal(statusCode, 403);
  roleGate({ auth: { role: "ADMIN" } }, response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
});

test("admin photo replacement forwards the selected target without permitting arbitrary URL inputs", async (t) => {
  const original = ProductImageService.replace;
  t.after(() => { ProductImageService.replace = original; });
  const calls = [];
  ProductImageService.replace = async (...args) => {
    calls.push(args);
    return { oldImageId: 41, newImageId: 42 };
  };
  const res = response();
  await replaceProductImage({
    params: { productId: "5", imageId: "41" },
    body: { replacementImageId: 42, url: "https://external.invalid/" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [["5", "41", 42]]);
  assert.deepEqual(res.payload, { success: true, replaced: { oldImageId: 41, newImageId: 42 } });
});
