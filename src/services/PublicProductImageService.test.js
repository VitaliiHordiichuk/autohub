import test from "node:test";
import assert from "node:assert/strict";

import { ProductPlaceholderService } from "./ProductPlaceholderService.js";
import { PublicProductImageService } from "./PublicProductImageService.js";

test("public site image candidates are normalized, filtered and ordered", () => {
  const image = PublicProductImageService.normalize({
    url: "https://cdn.example.test/products/processed/photo-1500.webp",
    variants: [
      { width: 1200, url: "https://cdn.example.test/products/processed/photo-1200.webp" },
      { width: 400, url: "https://cdn.example.test/products/processed/photo-400.webp" },
      { width: 999, url: "https://cdn.example.test/products/processed/photo-999.webp" },
      { width: 800, url: "" },
      { width: 1500, url: "https://cdn.example.test/products/processed/photo-1500.webp" },
    ],
  });

  assert.deepEqual(image, {
    url: "https://cdn.example.test/products/processed/photo-1500.webp",
    variants: [
      { width: 400, url: "https://cdn.example.test/products/processed/photo-400.webp" },
      { width: 1200, url: "https://cdn.example.test/products/processed/photo-1200.webp" },
      { width: 1500, url: "https://cdn.example.test/products/processed/photo-1500.webp" },
    ],
  });
});

test("public image SQL exposes processed site sizes only in PROCESSED display mode", () => {
  const query = PublicProductImageService.sql("pi");
  assert.match(query, /pi\.display_mode = 'PROCESSED'/);
  assert.match(query, /processed_url_400/);
  assert.match(query, /processed_url_800/);
  assert.match(query, /processed_url_1200/);
  assert.match(query, /processed_url_1600/);
  assert.doesNotMatch(query, /merchant_url_1500|original_url/);
});

test("placeholder presentation keeps responsive data for real images and safely falls back", () => {
  const siteUrl = "https://cdn.example.test/products/processed/photo-1500.webp";
  const real = ProductPlaceholderService.getProductImage({
    article: "A2711800109",
    imageUrls: [siteUrl],
    imageVariants: [{
      url: siteUrl,
      variants: [{ width: 400, url: "https://cdn.example.test/products/processed/photo-400.webp" }],
    }],
  });
  assert.equal(real.imageVariant.url, siteUrl);
  assert.equal(real.imageVariant.variants[0].width, 400);

  const legacy = ProductPlaceholderService.getProductImage({
    article: "A0005000801",
    imageUrls: ["https://cdn.example.test/legacy.webp"],
  });
  assert.deepEqual(legacy.imageVariant, {
    url: "https://cdn.example.test/legacy.webp",
    variants: [],
  });

  const placeholder = ProductPlaceholderService.getProductImage({
    article: "NOIMAGE",
    imageUrls: [],
  });
  assert.equal(placeholder.hasRealImage, false);
  assert.deepEqual(placeholder.imageVariants, []);
  assert.equal(placeholder.imageVariant.url, "/api/products/NOIMAGE/placeholder");
  assert.deepEqual(placeholder.imageVariant.variants, []);
});
