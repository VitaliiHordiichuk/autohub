import test from "node:test";
import assert from "node:assert/strict";

import sharp from "sharp";

import {
  DEFAULT_IMAGE_BRANDING_MODE,
  FULL_BRANDED_PATTERN,
  IMAGE_BRANDING_MODE,
  MAX_UPSCALE,
  PROCESSED_IMAGE_SIZE,
  WEBP_QUALITY,
  classifyImageQuality,
  processProductImage,
  resolveImageBrandingMode,
} from "./ProductImageProcessor.js";

const cases = [
  { name: "A landscape PNG", width: 800, height: 400, format: "png", contentWidth: 1200, contentHeight: 600, quality: "LOW_RESOLUTION" },
  { name: "B portrait JPEG", width: 400, height: 800, format: "jpeg", contentWidth: 600, contentHeight: 1200, quality: "LOW_RESOLUTION" },
  { name: "C square WebP", width: 300, height: 300, format: "webp", contentWidth: 450, contentHeight: 450, quality: "LOW_RESOLUTION" },
  { name: "D landscape PNG", width: 800, height: 600, format: "png", contentWidth: 1200, contentHeight: 900, quality: "OK" },
  { name: "E large JPEG", width: 1200, height: 1000, format: "jpeg", contentWidth: 1500, contentHeight: 1250, quality: "GOOD" },
  { name: "F oversized WebP", width: 2500, height: 1800, format: "webp", contentWidth: 1500, contentHeight: 1080, quality: "GOOD" },
];

async function fixture({ width, height, format }) {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 196, g: 30, b: 58 },
    },
  });
  if (format === "jpeg") return image.jpeg({ quality: 95 }).toBuffer();
  if (format === "webp") return image.webp({ quality: 95 }).toBuffer();
  return image.png().toBuffer();
}

for (const scenario of cases) {
  test(`processes ${scenario.name} on a square canvas without crop or excessive upscale`, async () => {
    const input = await fixture(scenario);
    const originalCopy = Buffer.from(input);
    const result = await processProductImage(input, {
      brandingMode: IMAGE_BRANDING_MODE.FULL_BRANDED,
    });
    const primary = result.variants[PROCESSED_IMAGE_SIZE];
    const metadata = await sharp(primary).metadata();

    assert.equal(input.equals(originalCopy), true, "the uploaded original buffer must stay unchanged");
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, PROCESSED_IMAGE_SIZE);
    assert.equal(metadata.height, PROCESSED_IMAGE_SIZE);
    assert.equal(result.metadata.originalWidth, scenario.width);
    assert.equal(result.metadata.originalHeight, scenario.height);
    assert.equal(result.metadata.processedWidth, PROCESSED_IMAGE_SIZE);
    assert.equal(result.metadata.processedHeight, PROCESSED_IMAGE_SIZE);
    assert.equal(result.metadata.contentWidth, scenario.contentWidth);
    assert.equal(result.metadata.contentHeight, scenario.contentHeight);
    assert.equal(result.metadata.qualityStatus, scenario.quality);
    assert.ok(result.metadata.scale <= MAX_UPSCALE);
    assert.ok(Math.abs(
      result.metadata.contentWidth / result.metadata.contentHeight
      - scenario.width / scenario.height,
    ) < 0.002, "the source aspect ratio must be preserved");

    for (const size of [1200, 800, 400]) {
      const variantMetadata = await sharp(result.variants[size]).metadata();
      assert.equal(variantMetadata.format, "webp");
      assert.equal(variantMetadata.width, size);
      assert.equal(variantMetadata.height, size);
    }
  });
}

test("uses documented processing constants and a white canvas around a small image", async () => {
  assert.equal(MAX_UPSCALE, 1.5);
  assert.equal(WEBP_QUALITY, 89);

  const input = await fixture({ width: 300, height: 300, format: "png" });
  const result = await processProductImage(input, {
    brandingMode: IMAGE_BRANDING_MODE.CLEAN,
  });
  const { data, info } = await sharp(result.variants[PROCESSED_IMAGE_SIZE])
    .extract({ left: 0, top: 0, width: 120, height: 120 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let nearWhitePixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset] >= 245 && data[offset + 1] >= 245 && data[offset + 2] >= 245) {
      nearWhitePixels += 1;
    }
  }
  assert.ok(nearWhitePixels / (info.width * info.height) > 0.5, "the canvas margin must remain white");
});

test("classifies image quality at the exact configured boundaries", () => {
  assert.equal(classifyImageQuality(499, 2000), "LOW_RESOLUTION");
  assert.equal(classifyImageQuality(500, 2000), "OK");
  assert.equal(classifyImageQuality(999, 2000), "OK");
  assert.equal(classifyImageQuality(1000, 2000), "GOOD");
});

test("supports clean, stamp-only and less dense full branding modes", async () => {
  const input = await fixture({ width: 800, height: 600, format: "png" });
  const [clean, stampOnly, fullBranded] = await Promise.all([
    processProductImage(input, { brandingMode: IMAGE_BRANDING_MODE.CLEAN }),
    processProductImage(input, { brandingMode: IMAGE_BRANDING_MODE.STAMP_ONLY }),
    processProductImage(input, { brandingMode: IMAGE_BRANDING_MODE.FULL_BRANDED }),
  ]);

  for (const result of [clean, stampOnly, fullBranded]) {
    const metadata = await sharp(result.variants[PROCESSED_IMAGE_SIZE]).metadata();
    assert.equal(metadata.width, PROCESSED_IMAGE_SIZE);
    assert.equal(metadata.height, PROCESSED_IMAGE_SIZE);
  }

  assert.equal(clean.metadata.brandingMode, "CLEAN");
  assert.deepEqual(clean.metadata.brandingLayers, []);
  assert.equal(stampOnly.metadata.brandingMode, "STAMP_ONLY");
  assert.deepEqual(stampOnly.metadata.brandingLayers, ["STAMP"]);
  assert.equal(fullBranded.metadata.brandingMode, "FULL_BRANDED");
  assert.deepEqual(fullBranded.metadata.brandingLayers, ["REPEATING_WATERMARK", "STAMP"]);
  assert.equal(clean.variants[PROCESSED_IMAGE_SIZE].equals(stampOnly.variants[PROCESSED_IMAGE_SIZE]), false);
  assert.equal(stampOnly.variants[PROCESSED_IMAGE_SIZE].equals(fullBranded.variants[PROCESSED_IMAGE_SIZE]), false);

  assert.equal(FULL_BRANDED_PATTERN.horizontalStep, 620);
  assert.equal(FULL_BRANDED_PATTERN.verticalStep, 420);
  assert.equal(FULL_BRANDED_PATTERN.opacity, 0.28);
  assert.ok(FULL_BRANDED_PATTERN.horizontalStep > 360);
  assert.ok(FULL_BRANDED_PATTERN.verticalStep > 245);
  assert.ok(FULL_BRANDED_PATTERN.opacity < 0.45);
});

test("uses FULL_BRANDED by default and accepts an env or explicit override", () => {
  assert.equal(DEFAULT_IMAGE_BRANDING_MODE, IMAGE_BRANDING_MODE.FULL_BRANDED);
  assert.equal(resolveImageBrandingMode(undefined, {}), IMAGE_BRANDING_MODE.FULL_BRANDED);
  assert.equal(
    resolveImageBrandingMode(undefined, { PRODUCT_IMAGE_BRANDING_MODE: "stamp_only" }),
    IMAGE_BRANDING_MODE.STAMP_ONLY,
  );
  assert.equal(
    resolveImageBrandingMode("clean", { PRODUCT_IMAGE_BRANDING_MODE: "FULL_BRANDED" }),
    IMAGE_BRANDING_MODE.CLEAN,
  );
  assert.throws(
    () => resolveImageBrandingMode("UNKNOWN", {}),
    /Некорректный режим брендирования/,
  );
});
