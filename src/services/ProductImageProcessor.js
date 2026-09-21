import { readFile } from "node:fs/promises";
import sharp from "sharp";

export const PROCESSED_IMAGE_SIZE = 1500;
export const PRODUCT_IMAGE_PROCESSING_VERSION = 4;
export const TARGET_FILL_RATIO = 0.85;
export const CROP_PADDING_RATIO = 0.08;
export const MAX_UPSCALE = 1.5;
export const WEBP_QUALITY = 89;
export const AUTO_CROP_THRESHOLD = 14;
export const BACKGROUND_COLOR_TOLERANCE = 28;
export const IMAGE_BRANDING_MODE = Object.freeze({
  CLEAN: "CLEAN",
  STAMP_ONLY: "STAMP_ONLY",
  FULL_BRANDED: "FULL_BRANDED",
});
export const DEFAULT_IMAGE_BRANDING_MODE = IMAGE_BRANDING_MODE.FULL_BRANDED;
export const FULL_BRANDED_PATTERN = Object.freeze({
  horizontalStep: 620,
  verticalStep: 420,
  width: 270,
  height: 73,
  opacity: 0.28,
  rotation: -18,
});

const RESPONSIVE_SIZES = [1200, 800, 400];
const logoPath = new URL("../assets/product-watermark.svg", import.meta.url);

function patternSvg(logoDataUri, width, height) {
  const tiles = [];
  const rows = Math.ceil(height / FULL_BRANDED_PATTERN.verticalStep) + 2;
  const columns = Math.ceil(width / FULL_BRANDED_PATTERN.horizontalStep) + 2;
  for (let row = -1; row < rows; row += 1) {
    for (let column = -1; column < columns; column += 1) {
      const x = column * FULL_BRANDED_PATTERN.horizontalStep
        + (row % 2 ? FULL_BRANDED_PATTERN.horizontalStep / 2 : 0);
      const y = row * FULL_BRANDED_PATTERN.verticalStep;
      const centerX = x + FULL_BRANDED_PATTERN.width / 2;
      const centerY = y + FULL_BRANDED_PATTERN.height / 2;
      tiles.push(`<image href="${logoDataUri}" x="${x}" y="${y}" width="${FULL_BRANDED_PATTERN.width}" height="${FULL_BRANDED_PATTERN.height}" opacity="${FULL_BRANDED_PATTERN.opacity}" transform="rotate(${FULL_BRANDED_PATTERN.rotation} ${centerX} ${centerY})"/>`);
    }
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${tiles.join("")}</svg>`);
}

function protectionSvg(width, height) {
  const signatureWidth = Math.min(500, Math.round(width * 0.46));
  const signatureHeight = Math.round(signatureWidth * 0.205);
  const margin = Math.max(22, Math.round(Math.min(width, height) * 0.025));
  const x = width - signatureWidth - margin;
  const y = height - signatureHeight - margin;
  const radius = Math.round(signatureHeight * 0.24);
  const fontSize = Math.round(signatureWidth * 0.08);
  const emblemCenterX = x + signatureHeight * 0.58;
  const emblemCenterY = y + signatureHeight / 2;
  const emblemRadius = signatureHeight * 0.34;
  const siteTextCenterX = x + signatureHeight * 1.18 + (signatureWidth - signatureHeight * 1.18) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${x}" y="${y}" width="${signatureWidth}" height="${signatureHeight}" rx="${radius}" fill="#07131c" opacity="0.92"/>
    <rect x="${x}" y="${y}" width="${signatureWidth}" height="${signatureHeight}" rx="${radius}" fill="none" stroke="#d9a347" stroke-width="4" opacity="0.95"/>
    <circle cx="${emblemCenterX}" cy="${emblemCenterY}" r="${emblemRadius}" fill="#f8f2e9" stroke="#d9a347" stroke-width="3"/>
    <path d="M ${emblemCenterX - emblemRadius * 1.05} ${emblemCenterY} Q ${emblemCenterX} ${emblemCenterY - emblemRadius * 0.20} ${emblemCenterX + emblemRadius * 1.05} ${emblemCenterY} Q ${emblemCenterX} ${emblemCenterY + emblemRadius * 0.20} ${emblemCenterX - emblemRadius * 1.05} ${emblemCenterY} Z" fill="#d9a347" opacity="0.95"/>
    <text x="${emblemCenterX}" y="${emblemCenterY + emblemRadius * 0.54}" text-anchor="middle" fill="#3e4650" font-family="Georgia,serif" font-size="${emblemRadius * 1.55}" font-weight="700">M</text>
    <text x="${siteTextCenterX}" y="${y + signatureHeight * 0.665}" text-anchor="middle" fill="#f5bd5d" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="1.2">MAKA.com.ua</text>
  </svg>`);
}

export function classifyImageQuality(width, height) {
  const smallerDimension = Math.min(Number(width) || 0, Number(height) || 0);
  if (smallerDimension >= 1000) return "GOOD";
  if (smallerDimension >= 500) return "OK";
  return "LOW_RESOLUTION";
}

export function resolveImageBrandingMode(mode, environment = process.env) {
  const configured = String(
    mode ?? environment.PRODUCT_IMAGE_BRANDING_MODE ?? DEFAULT_IMAGE_BRANDING_MODE,
  ).trim().toUpperCase();
  if (!Object.values(IMAGE_BRANDING_MODE).includes(configured)) {
    throw new Error(`Некорректный режим брендирования изображения: ${configured}`);
  }
  return configured;
}

export function calculateContainedDimensions(width, height) {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0
    || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new Error("Не удалось определить размеры исходного изображения");
  }

  const scale = Math.min(
    (PROCESSED_IMAGE_SIZE * TARGET_FILL_RATIO) / sourceWidth,
    (PROCESSED_IMAGE_SIZE * TARGET_FILL_RATIO) / sourceHeight,
    MAX_UPSCALE,
  );

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

function colorDistance(first, second) {
  return Math.sqrt(
    (first.r - second.r) ** 2
    + (first.g - second.g) ** 2
    + (first.b - second.b) ** 2,
  );
}

function samplePatch(data, channels, size, startX, startY, patchSize) {
  const totals = { r: 0, g: 0, b: 0 };
  let pixels = 0;
  for (let y = startY; y < startY + patchSize; y += 1) {
    for (let x = startX; x < startX + patchSize; x += 1) {
      const offset = (y * size + x) * channels;
      totals.r += data[offset];
      totals.g += data[offset + 1];
      totals.b += data[offset + 2];
      pixels += 1;
    }
  }
  return {
    r: Math.round(totals.r / pixels),
    g: Math.round(totals.g / pixels),
    b: Math.round(totals.b / pixels),
  };
}

async function detectUniformBorderColour(input) {
  const sampleSize = 32;
  const patchSize = 4;
  const { data, info } = await sharp(input)
    .resize({ width: sampleSize, height: sampleSize, fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const lastPatch = sampleSize - patchSize;
  const corners = [
    samplePatch(data, info.channels, sampleSize, 0, 0, patchSize),
    samplePatch(data, info.channels, sampleSize, lastPatch, 0, patchSize),
    samplePatch(data, info.channels, sampleSize, 0, lastPatch, patchSize),
    samplePatch(data, info.channels, sampleSize, lastPatch, lastPatch, patchSize),
  ];
  const background = {
    r: Math.round(corners.reduce((sum, colour) => sum + colour.r, 0) / corners.length),
    g: Math.round(corners.reduce((sum, colour) => sum + colour.g, 0) / corners.length),
    b: Math.round(corners.reduce((sum, colour) => sum + colour.b, 0) / corners.length),
  };
  return corners.every((colour) => colorDistance(colour, background) <= BACKGROUND_COLOR_TOLERANCE)
    ? background
    : null;
}

export async function detectProductBounds(input) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const metadata = await sharp(source).metadata();
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  const fullImage = { left: 0, top: 0, width, height, detected: false };
  if (!width || !height) return fullImage;

  const background = await detectUniformBorderColour(source);
  if (!background) return fullImage;

  const trimmed = await sharp(source)
    .trim({ background, threshold: AUTO_CROP_THRESHOLD })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.max(0, Math.min(width - 1, -(trimmed.info.trimOffsetLeft || 0)));
  const top = Math.max(0, Math.min(height - 1, -(trimmed.info.trimOffsetTop || 0)));
  const detectedWidth = Math.min(Number(trimmed.info.width) || width, width - left);
  const detectedHeight = Math.min(Number(trimmed.info.height) || height, height - top);
  const detectedAreaRatio = (detectedWidth * detectedHeight) / (width * height);
  if (detectedWidth < 8 || detectedHeight < 8 || detectedAreaRatio < 0.0025) return fullImage;

  const detected = left > 0 || top > 0 || detectedWidth < width || detectedHeight < height;
  return { left, top, width: detectedWidth, height: detectedHeight, detected };
}

export async function normalizeProductComposition(input, {
  targetFillRatio = TARGET_FILL_RATIO,
  cropPaddingRatio = CROP_PADDING_RATIO,
  maxUpscale = MAX_UPSCALE,
} = {}) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const bounds = await detectProductBounds(source);
  const longestSide = Math.max(bounds.width, bounds.height);
  const paddedWidth = bounds.width * (1 + cropPaddingRatio * 2);
  const paddedHeight = bounds.height * (1 + cropPaddingRatio * 2);
  const scale = Math.min(
    (PROCESSED_IMAGE_SIZE * targetFillRatio) / longestSide,
    PROCESSED_IMAGE_SIZE / paddedWidth,
    PROCESSED_IMAGE_SIZE / paddedHeight,
    maxUpscale,
  );
  const contentWidth = Math.max(1, Math.round(bounds.width * scale));
  const contentHeight = Math.max(1, Math.round(bounds.height * scale));
  const paddingX = Math.max(1, Math.round(bounds.width * cropPaddingRatio * scale));
  const paddingY = Math.max(1, Math.round(bounds.height * cropPaddingRatio * scale));
  const preparedWidth = Math.min(PROCESSED_IMAGE_SIZE, contentWidth + paddingX * 2);
  const preparedHeight = Math.min(PROCESSED_IMAGE_SIZE, contentHeight + paddingY * 2);
  const cropped = await sharp(source)
    .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
    .resize({ width: contentWidth, height: contentHeight, fit: "fill" })
    .png()
    .toBuffer();
  const prepared = await sharp({
    create: {
      width: preparedWidth,
      height: preparedHeight,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([{
      input: cropped,
      left: Math.floor((preparedWidth - contentWidth) / 2),
      top: Math.floor((preparedHeight - contentHeight) / 2),
    }])
    .png()
    .toBuffer();
  const baseCanvas = await sharp({
    create: {
      width: PROCESSED_IMAGE_SIZE,
      height: PROCESSED_IMAGE_SIZE,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([{
      input: prepared,
      left: Math.floor((PROCESSED_IMAGE_SIZE - preparedWidth) / 2),
      top: Math.floor((PROCESSED_IMAGE_SIZE - preparedHeight) / 2),
    }])
    .png()
    .toBuffer();

  return {
    baseCanvas,
    bounds,
    scale,
    contentWidth,
    contentHeight,
    preparedWidth,
    preparedHeight,
    fillRatio: Math.max(contentWidth, contentHeight) / PROCESSED_IMAGE_SIZE,
  };
}

async function prepareBaseCanvas(input) {
  const normalized = await sharp(input, {
    failOn: "warning",
    limitInputPixels: 80_000_000,
  })
    .rotate()
    .toColorspace("srgb")
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer({ resolveWithObject: true });

  const originalWidth = normalized.info.width;
  const originalHeight = normalized.info.height;
  const composition = await normalizeProductComposition(normalized.data);

  return {
    baseCanvas: composition.baseCanvas,
    metadata: {
      originalWidth,
      originalHeight,
      processedWidth: PROCESSED_IMAGE_SIZE,
      processedHeight: PROCESSED_IMAGE_SIZE,
      contentWidth: composition.contentWidth,
      contentHeight: composition.contentHeight,
      preparedWidth: composition.preparedWidth,
      preparedHeight: composition.preparedHeight,
      scale: composition.scale,
      fillRatio: composition.fillRatio,
      autoCropApplied: composition.bounds.detected,
      detectedBounds: {
        left: composition.bounds.left,
        top: composition.bounds.top,
        width: composition.bounds.width,
        height: composition.bounds.height,
      },
      qualityStatus: classifyImageQuality(originalWidth, originalHeight),
    },
  };
}

async function applyBranding(baseCanvas, mode) {
  if (mode === IMAGE_BRANDING_MODE.CLEAN) {
    return { image: baseCanvas, layers: [] };
  }

  const composites = [];
  const layers = [];
  if (mode === IMAGE_BRANDING_MODE.FULL_BRANDED) {
    const logo = await readFile(logoPath);
    const logoDataUri = `data:image/svg+xml;base64,${logo.toString("base64")}`;
    composites.push({
      input: patternSvg(logoDataUri, PROCESSED_IMAGE_SIZE, PROCESSED_IMAGE_SIZE),
      left: 0,
      top: 0,
    });
    layers.push("REPEATING_WATERMARK");
  }

  composites.push({
    input: protectionSvg(PROCESSED_IMAGE_SIZE, PROCESSED_IMAGE_SIZE),
    left: 0,
    top: 0,
  });
  layers.push("STAMP");

  return {
    image: await sharp(baseCanvas).composite(composites).png().toBuffer(),
    layers,
  };
}

async function encodeWebp(master, size) {
  return sharp(master)
    .resize({ width: size, height: size, fit: "fill", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 5, smartSubsample: true })
    .toBuffer();
}

export async function processProductImage(input, { brandingMode } = {}) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const resolvedBrandingMode = resolveImageBrandingMode(brandingMode);
  const { baseCanvas, metadata } = await prepareBaseCanvas(source);
  const branded = await applyBranding(baseCanvas, resolvedBrandingMode);
  const sizes = [PROCESSED_IMAGE_SIZE, ...RESPONSIVE_SIZES];
  const [encoded, separateMerchantVariant] = await Promise.all([
    Promise.all(
      sizes.map(async (size) => [size, await encodeWebp(branded.image, size)]),
    ),
    resolvedBrandingMode === IMAGE_BRANDING_MODE.CLEAN
      ? Promise.resolve(null)
      : encodeWebp(baseCanvas, PROCESSED_IMAGE_SIZE),
  ]);
  const variants = Object.fromEntries(encoded);

  return {
    variants,
    merchant: {
      variant: separateMerchantVariant || variants[PROCESSED_IMAGE_SIZE],
      metadata: {
        ...metadata,
        brandingMode: IMAGE_BRANDING_MODE.CLEAN,
        brandingLayers: [],
      },
    },
    metadata: {
      ...metadata,
      brandingMode: resolvedBrandingMode,
      brandingLayers: branded.layers,
    },
  };
}

export const ProductImageProcessor = {
  process: processProductImage,
};
