import test from "node:test";
import assert from "node:assert/strict";

import sharp from "sharp";

import {
  CROP_PADDING_RATIO,
  DEFAULT_IMAGE_BRANDING_MODE,
  FULL_BRANDED_PATTERN,
  IMAGE_BRANDING_MODE,
  MAX_UPSCALE,
  PROCESSED_IMAGE_SIZE,
  PRODUCT_IMAGE_PROCESSING_VERSION,
  TARGET_FILL_RATIO,
  WEBP_QUALITY,
  classifyImageQuality,
  detectProductBounds,
  processProductImage,
  processMerchantProductImage,
  resolveImageBrandingMode,
} from "./ProductImageProcessor.js";

const cases = [
  { name: "A landscape PNG", width: 800, height: 400, format: "png", contentWidth: 1200, contentHeight: 600, quality: "LOW_RESOLUTION" },
  { name: "B portrait JPEG", width: 400, height: 800, format: "jpeg", contentWidth: 600, contentHeight: 1200, quality: "LOW_RESOLUTION" },
  { name: "C square WebP", width: 300, height: 300, format: "webp", contentWidth: 450, contentHeight: 450, quality: "LOW_RESOLUTION" },
  { name: "D landscape PNG", width: 800, height: 600, format: "png", contentWidth: 1200, contentHeight: 900, quality: "OK" },
  { name: "E large JPEG", width: 1200, height: 1000, format: "jpeg", contentWidth: 1275, contentHeight: 1063, quality: "GOOD" },
  { name: "F oversized WebP", width: 2500, height: 1800, format: "webp", contentWidth: 1275, contentHeight: 918, quality: "GOOD" },
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

async function objectFixture({
  width,
  height,
  objectLeft,
  objectTop,
  objectWidth,
  objectHeight,
}) {
  const object = await sharp({
    create: {
      width: objectWidth,
      height: objectHeight,
      channels: 3,
      background: { r: 170, g: 25, b: 45 },
    },
  }).png().toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([{ input: object, left: objectLeft, top: objectTop }])
    .png()
    .toBuffer();
}

async function darkPixelBounds(input) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width; let top = info.height; let right = -1; let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset] < 225 || data[offset + 1] < 225 || data[offset + 2] < 225) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
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
  assert.equal(PRODUCT_IMAGE_PROCESSING_VERSION, 4);
  assert.equal(TARGET_FILL_RATIO, 0.85);
  assert.equal(CROP_PADDING_RATIO, 0.08);
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

test("auto-crops a small object from a large empty background and centers it", async () => {
  const input = await objectFixture({
    width: 1600, height: 1200,
    objectLeft: 400, objectTop: 450, objectWidth: 800, objectHeight: 300,
  });
  const bounds = await detectProductBounds(input);
  assert.deepEqual(bounds, { left: 400, top: 450, width: 800, height: 300, detected: true });

  const result = await processProductImage(input, { brandingMode: IMAGE_BRANDING_MODE.CLEAN });
  const visible = await darkPixelBounds(result.variants[PROCESSED_IMAGE_SIZE]);
  assert.equal(result.metadata.autoCropApplied, true);
  assert.equal(result.metadata.contentWidth, 1200);
  assert.equal(result.metadata.contentHeight, 450);
  assert.equal(result.metadata.scale, MAX_UPSCALE);
  assert.ok(Math.abs((visible.left + visible.width / 2) - PROCESSED_IMAGE_SIZE / 2) <= 2);
  assert.ok(Math.abs((visible.top + visible.height / 2) - PROCESSED_IMAGE_SIZE / 2) <= 2);
  assert.ok(visible.width > 1100, "the product should be visibly larger after empty margins are removed");
});

test("normalizes horizontal and vertical products without cropping or distortion", async () => {
  const scenarios = [
    { objectLeft: 300, objectTop: 420, objectWidth: 1000, objectHeight: 160 },
    { objectLeft: 710, objectTop: 100, objectWidth: 180, objectHeight: 1000 },
  ];
  for (const scenario of scenarios) {
    const input = await objectFixture({ width: 1600, height: 1200, ...scenario });
    const result = await processProductImage(input, { brandingMode: IMAGE_BRANDING_MODE.CLEAN });
    const visible = await darkPixelBounds(result.variants[PROCESSED_IMAGE_SIZE]);
    assert.equal(result.metadata.autoCropApplied, true);
    assert.ok(Math.abs(result.metadata.fillRatio - TARGET_FILL_RATIO) < 0.002);
    assert.ok(Math.abs(
      visible.width / visible.height - scenario.objectWidth / scenario.objectHeight,
    ) < 0.03);
    assert.ok(Math.abs((visible.left + visible.width / 2) - PROCESSED_IMAGE_SIZE / 2) <= 2);
    assert.ok(Math.abs((visible.top + visible.height / 2) - PROCESSED_IMAGE_SIZE / 2) <= 2);
  }
});

test("caps a low-resolution cropped product at MAX_UPSCALE", async () => {
  const input = await objectFixture({
    width: 480, height: 420,
    objectLeft: 140, objectTop: 150, objectWidth: 200, objectHeight: 120,
  });
  const result = await processProductImage(input, { brandingMode: IMAGE_BRANDING_MODE.CLEAN });
  assert.equal(result.metadata.scale, MAX_UPSCALE);
  assert.equal(result.metadata.contentWidth, 300);
  assert.equal(result.metadata.contentHeight, 180);
  assert.equal(result.metadata.qualityStatus, "LOW_RESOLUTION");
  assert.ok(result.metadata.fillRatio < TARGET_FILL_RATIO);
});

test("brings a large high-quality product to the target fill", async () => {
  const input = await objectFixture({
    width: 2200, height: 1600,
    objectLeft: 500, objectTop: 400, objectWidth: 1200, objectHeight: 800,
  });
  const result = await processProductImage(input, { brandingMode: IMAGE_BRANDING_MODE.CLEAN });
  assert.equal(result.metadata.qualityStatus, "GOOD");
  assert.equal(result.metadata.contentWidth, 1275);
  assert.equal(result.metadata.contentHeight, 850);
  assert.ok(Math.abs(result.metadata.fillRatio - TARGET_FILL_RATIO) < 0.002);
});

test("uses the same safe composition for the clean Merchant branch", async () => {
  const input = await objectFixture({
    width: 2200, height: 1600,
    objectLeft: 500, objectTop: 400, objectWidth: 1200, objectHeight: 800,
  });
  const result = await processProductImage(input, {
    brandingMode: IMAGE_BRANDING_MODE.FULL_BRANDED,
  });
  const merchantOnly = await processMerchantProductImage(input);
  const merchantVisible = await darkPixelBounds(result.merchant.variant);

  assert.equal(result.merchant.metadata.brandingMode, IMAGE_BRANDING_MODE.CLEAN);
  assert.deepEqual(result.merchant.metadata.brandingLayers, []);
  assert.equal(result.merchant.metadata.contentWidth, 1275);
  assert.equal(result.merchant.metadata.contentHeight, 850);
  assert.ok(Math.abs(result.merchant.metadata.fillRatio - TARGET_FILL_RATIO) < 0.002);
  assert.ok(result.merchant.metadata.scale <= MAX_UPSCALE);
  assert.ok(Math.abs(merchantVisible.width / merchantVisible.height - 1200 / 800) < 0.03);
  assert.ok(Math.abs((merchantVisible.left + merchantVisible.width / 2) - PROCESSED_IMAGE_SIZE / 2) <= 2);
  assert.ok(Math.abs((merchantVisible.top + merchantVisible.height / 2) - PROCESSED_IMAGE_SIZE / 2) <= 2);
  assert.equal(merchantOnly.variant.equals(result.merchant.variant), true);
  assert.equal(merchantOnly.metadata.brandingMode, IMAGE_BRANDING_MODE.CLEAN);
  assert.deepEqual(merchantOnly.metadata.brandingLayers, []);
});

test("keeps full bounds when the outer background is not uniform", async () => {
  const corner = async (background) => sharp({
    create: { width: 240, height: 180, channels: 3, background },
  }).png().toBuffer();
  const input = await sharp({
    create: { width: 1000, height: 800, channels: 3, background: "#ffffff" },
  }).composite([
    { input: await corner("#c52b38"), left: 0, top: 0 },
    { input: await corner("#2865ba"), left: 760, top: 0 },
    { input: await corner("#36944d"), left: 0, top: 620 },
    { input: await corner("#d5a52f"), left: 760, top: 620 },
  ]).png().toBuffer();

  assert.deepEqual(await detectProductBounds(input), {
    left: 0, top: 0, width: 1000, height: 800, detected: false,
  });
});

test("classifies image quality at the exact configured boundaries", () => {
  assert.equal(classifyImageQuality(499, 2000), "LOW_RESOLUTION");
  assert.equal(classifyImageQuality(500, 2000), "OK");
  assert.equal(classifyImageQuality(999, 2000), "OK");
  assert.equal(classifyImageQuality(1000, 2000), "GOOD");
});

test("supports clean, stamp-only and less dense full branding modes", async () => {
  const input = await objectFixture({
    width: 1400, height: 1000,
    objectLeft: 300, objectTop: 350, objectWidth: 800, objectHeight: 300,
  });
  const [clean, stampOnly, fullBranded] = await Promise.all([
    processProductImage(input, { brandingMode: IMAGE_BRANDING_MODE.CLEAN }),
    processProductImage(input, { brandingMode: IMAGE_BRANDING_MODE.STAMP_ONLY }),
    processProductImage(input, { brandingMode: IMAGE_BRANDING_MODE.FULL_BRANDED }),
  ]);

  for (const result of [clean, stampOnly, fullBranded]) {
    const metadata = await sharp(result.variants[PROCESSED_IMAGE_SIZE]).metadata();
    const merchantMetadata = await sharp(result.merchant.variant).metadata();
    assert.equal(metadata.width, PROCESSED_IMAGE_SIZE);
    assert.equal(metadata.height, PROCESSED_IMAGE_SIZE);
    assert.equal(merchantMetadata.format, "webp");
    assert.equal(merchantMetadata.width, PROCESSED_IMAGE_SIZE);
    assert.equal(merchantMetadata.height, PROCESSED_IMAGE_SIZE);
    assert.equal(result.metadata.autoCropApplied, true);
    assert.equal(result.merchant.metadata.autoCropApplied, true);
    assert.equal(result.merchant.metadata.brandingMode, IMAGE_BRANDING_MODE.CLEAN);
    assert.deepEqual(result.merchant.metadata.brandingLayers, []);
    assert.deepEqual(result.metadata.detectedBounds, { left: 300, top: 350, width: 800, height: 300 });
  }

  assert.equal(clean.metadata.brandingMode, "CLEAN");
  assert.deepEqual(clean.metadata.brandingLayers, []);
  assert.equal(stampOnly.metadata.brandingMode, "STAMP_ONLY");
  assert.deepEqual(stampOnly.metadata.brandingLayers, ["STAMP"]);
  assert.equal(fullBranded.metadata.brandingMode, "FULL_BRANDED");
  assert.deepEqual(fullBranded.metadata.brandingLayers, ["REPEATING_WATERMARK", "STAMP"]);
  assert.equal(clean.variants[PROCESSED_IMAGE_SIZE].equals(stampOnly.variants[PROCESSED_IMAGE_SIZE]), false);
  assert.equal(stampOnly.variants[PROCESSED_IMAGE_SIZE].equals(fullBranded.variants[PROCESSED_IMAGE_SIZE]), false);
  assert.equal(clean.merchant.variant.equals(clean.variants[PROCESSED_IMAGE_SIZE]), true);
  assert.equal(clean.merchant.variant.equals(stampOnly.merchant.variant), true);
  assert.equal(clean.merchant.variant.equals(fullBranded.merchant.variant), true);
  assert.equal(fullBranded.merchant.variant.equals(fullBranded.variants[PROCESSED_IMAGE_SIZE]), false);

  const merchantCorner = await sharp(fullBranded.merchant.variant)
    .extract({ left: 0, top: 0, width: 80, height: 80 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.equal(
    [...merchantCorner].every((channel) => channel >= 245),
    true,
    "Merchant image must retain a clean white canvas without site branding",
  );

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
