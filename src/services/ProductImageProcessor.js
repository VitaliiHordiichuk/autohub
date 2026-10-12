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
export const IMAGE_PROCESSING_MODE = Object.freeze({
  LEGACY: "LEGACY",
  SMART_SAFE: "SMART_SAFE",
  PRODUCT_MAX: "PRODUCT_MAX",
  PRODUCT_FOCUS: "PRODUCT_FOCUS",
});
export const SMART_PRODUCT_IMAGE_PROCESSING_VERSION = 5;
export const PRODUCT_MAX_IMAGE_PROCESSING_VERSION = 6;
export const SMART_FRAME_FILL_RATIO = 0.96;
export const SMART_CROP_PADDING_RATIO = 0.06;
export const SMART_WEBP_QUALITY = 90;
export const PRODUCT_MAX_TARGET_FILL_RATIO = 0.88;
export const PRODUCT_MAX_SAFE_FRAME_FILL_RATIO = 0.96;
export const PRODUCT_MAX_CROP_PADDING_RATIO = 0.045;
export const IMAGE_REVIEW_STATUS = Object.freeze({
  APPROVED: "APPROVED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
});
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

export function resolveImageProcessingMode(mode) {
  const configured = String(mode ?? IMAGE_PROCESSING_MODE.LEGACY).trim().toUpperCase();
  if (!Object.values(IMAGE_PROCESSING_MODE).includes(configured)) {
    throw new Error(`Некорректный режим обработки изображения: ${configured}`);
  }
  return configured;
}

export function isSmartProductImageProcessingEnabled(environment = process.env) {
  return String(environment.SMART_PRODUCT_IMAGES_ENABLED || "").trim().toLowerCase() === "true";
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

function median(values) {
  const ordered = [...values].sort((first, second) => first - second);
  return ordered[Math.floor(ordered.length / 2)] || 0;
}

function percentile(values, fraction) {
  const ordered = [...values].sort((first, second) => first - second);
  if (!ordered.length) return 0;
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
}

async function detectHighConfidenceBorderColour(input) {
  const sampleSize = 96;
  const borderWidth = 5;
  const { data, info } = await sharp(input)
    .resize({ width: sampleSize, height: sampleSize, fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const borderPixels = [];
  for (let y = 0; y < sampleSize; y += 1) {
    for (let x = 0; x < sampleSize; x += 1) {
      if (x >= borderWidth && x < sampleSize - borderWidth
        && y >= borderWidth && y < sampleSize - borderWidth) continue;
      const offset = (y * sampleSize + x) * info.channels;
      borderPixels.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
    }
  }
  const background = {
    r: median(borderPixels.map((pixel) => pixel.r)),
    g: median(borderPixels.map((pixel) => pixel.g)),
    b: median(borderPixels.map((pixel) => pixel.b)),
  };
  const distances = borderPixels.map((pixel) => colorDistance(pixel, background));
  const p90Distance = percentile(distances, 0.9);
  const p98Distance = percentile(distances, 0.98);
  const uniform = p90Distance <= 18 && p98Distance <= 34;
  return { background, uniform, p90Distance, p98Distance };
}

function expandBounds(bounds, width, height, paddingRatio) {
  const horizontalPadding = Math.ceil(bounds.width * paddingRatio);
  const verticalPadding = Math.ceil(bounds.height * paddingRatio);
  const left = Math.max(0, bounds.left - horizontalPadding);
  const top = Math.max(0, bounds.top - verticalPadding);
  const right = Math.min(width, bounds.left + bounds.width + horizontalPadding);
  const bottom = Math.min(height, bounds.top + bounds.height + verticalPadding);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function normalizedManualCrop(crop, width, height) {
  if (!crop || typeof crop !== "object") {
    throw new Error("выбери область кадра");
  }
  const values = [crop.left, crop.top, crop.width, crop.height].map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Некорректная область кадра");
  }
  const [left, top, cropWidth, cropHeight] = values;
  if (left < 0 || top < 0 || cropWidth < 0.02 || cropHeight < 0.02
    || left + cropWidth > 1.000001 || top + cropHeight > 1.000001) {
    throw new Error("Область кадра должна находиться внутри исходного изображения");
  }
  const pixelLeft = Math.min(width - 1, Math.max(0, Math.floor(left * width)));
  const pixelTop = Math.min(height - 1, Math.max(0, Math.floor(top * height)));
  const pixelRight = Math.min(width, Math.max(pixelLeft + 1, Math.ceil((left + cropWidth) * width)));
  const pixelBottom = Math.min(height, Math.max(pixelTop + 1, Math.ceil((top + cropHeight) * height)));
  return {
    left: pixelLeft,
    top: pixelTop,
    width: pixelRight - pixelLeft,
    height: pixelBottom - pixelTop,
  };
}

function intersectBounds(first, second) {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.left + first.width, second.left + second.width);
  const bottom = Math.min(first.top + first.height, second.top + second.height);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function retainedBoundsRatio(contentBounds, cropBounds) {
  const visible = intersectBounds(contentBounds, cropBounds);
  return (visible.width * visible.height)
    / Math.max(1, contentBounds.width * contentBounds.height);
}

/**
 * Estimates meaningful content for PRODUCT MAX. The estimate may measure scale
 * on any background, but automatic cropping trusts it only when the sampled
 * outer border is uniform.
 */
export async function analyzeProductMaxContent(input) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const metadata = await sharp(source).metadata();
  const sourceWidth = Number(metadata.width);
  const sourceHeight = Number(metadata.height);
  if (!sourceWidth || !sourceHeight) {
    throw new Error("Не удалось определить размеры исходного изображения");
  }

  const sampleLimit = 512;
  const sample = await sharp(source)
    .resize({ width: sampleLimit, height: sampleLimit, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = sample.info;
  const borderWidth = Math.max(3, Math.round(Math.min(width, height) * 0.025));
  const borderPixels = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= borderWidth && x < width - borderWidth
        && y >= borderWidth && y < height - borderWidth) continue;
      const offset = (y * width + x) * channels;
      borderPixels.push({
        r: sample.data[offset],
        g: sample.data[offset + 1],
        b: sample.data[offset + 2],
      });
    }
  }
  const background = {
    r: median(borderPixels.map((pixel) => pixel.r)),
    g: median(borderPixels.map((pixel) => pixel.g)),
    b: median(borderPixels.map((pixel) => pixel.b)),
  };
  const borderDistances = borderPixels.map((pixel) => colorDistance(pixel, background));
  const p90Distance = percentile(borderDistances, 0.9);
  const p98Distance = percentile(borderDistances, 0.98);
  const uniformBorder = p90Distance <= 24 && p98Distance <= 48;
  const threshold = Math.max(20, Math.min(72, p90Distance * 1.45 + 10));
  const pixelCount = width * height;
  const mask = new Uint8Array(pixelCount);
  const strengths = new Float32Array(pixelCount);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * channels;
      const strength = colorDistance({
        r: sample.data[offset],
        g: sample.data[offset + 1],
        b: sample.data[offset + 2],
      }, background);
      strengths[index] = strength;
      if (strength >= threshold) mask[index] = 1;
    }
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let area = 0;
    let strengthTotal = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      strengthTotal += strengths[index];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbours = [index - 1, index + 1, index - width, index + width];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= pixelCount || visited[neighbour] || !mask[neighbour]) {
          continue;
        }
        if (Math.abs((neighbour % width) - x) > 1) continue;
        visited[neighbour] = 1;
        queue[tail++] = neighbour;
      }
    }
    components.push({
      area,
      meanStrength: strengthTotal / area,
      minX,
      minY,
      maxX,
      maxY,
      touchedEdges: [minX === 0, minY === 0, maxX === width - 1, maxY === height - 1]
        .filter(Boolean).length,
    });
  }
  components.sort((first, second) => second.area - first.area);
  const largestArea = components[0]?.area || 0;
  const minimumArea = Math.max(18, Math.round(pixelCount * 0.00012));
  const kept = components.filter((component) => {
    if (component.area < minimumArea && component.area < largestArea * 0.002) return false;
    if (component.touchedEdges >= 2 && component.area < pixelCount * 0.08) return false;
    return true;
  });
  const sampleBounds = kept.length ? {
    left: Math.min(...kept.map((component) => component.minX)),
    top: Math.min(...kept.map((component) => component.minY)),
    right: Math.max(...kept.map((component) => component.maxX + 1)),
    bottom: Math.max(...kept.map((component) => component.maxY + 1)),
  } : { left: 0, top: 0, right: width, bottom: height };
  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  const left = Math.max(0, Math.floor(sampleBounds.left * scaleX));
  const top = Math.max(0, Math.floor(sampleBounds.top * scaleY));
  const right = Math.min(sourceWidth, Math.ceil(sampleBounds.right * scaleX));
  const bottom = Math.min(sourceHeight, Math.ceil(sampleBounds.bottom * scaleY));
  const bounds = {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
  const boundsAreaRatio = (bounds.width * bounds.height) / (sourceWidth * sourceHeight);
  const measurementConfidence = kept.length === 0
    ? "LOW"
    : uniformBorder
      ? "HIGH"
      : boundsAreaRatio < 0.92 && kept.length <= 24
        ? "MEDIUM"
        : "LOW";

  return {
    bounds,
    sourceWidth,
    sourceHeight,
    uniformBorder,
    measurementConfidence,
    background,
    p90Distance,
    p98Distance,
    threshold,
    componentCount: components.length,
    keptComponentCount: kept.length,
  };
}

export async function detectProductMaxBounds(input, {
  crop,
  cropPaddingRatio = PRODUCT_MAX_CROP_PADDING_RATIO,
} = {}) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const metadata = await sharp(source).metadata();
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (!width || !height) throw new Error("Не удалось определить размеры исходного изображения");
  const analysis = await analyzeProductMaxContent(source);
  const fullImage = { left: 0, top: 0, width, height };

  if (crop) {
    const manualBounds = normalizedManualCrop(crop, width, height);
    const retainedContentRatio = retainedBoundsRatio(analysis.bounds, manualBounds);
    return {
      ...manualBounds,
      detected: true,
      method: "MANUAL_CONTENT_BOUNDS",
      confidence: "MANUAL",
      reviewStatus: retainedContentRatio >= 0.995
        ? IMAGE_REVIEW_STATUS.APPROVED
        : IMAGE_REVIEW_STATUS.NEEDS_REVIEW,
      reviewReason: retainedContentRatio >= 0.995 ? null : "MANUAL_BOUNDS_EXCLUDE_DETECTED_CONTENT",
      manualCropSuggested: false,
      retainedContentRatio,
      analysis,
    };
  }

  if (!analysis.uniformBorder || analysis.measurementConfidence !== "HIGH") {
    const estimatedFill = Math.max(analysis.bounds.width, analysis.bounds.height)
      / Math.max(width, height) * PRODUCT_MAX_SAFE_FRAME_FILL_RATIO;
    const manualCropSuggested = estimatedFill < 0.82;
    return {
      ...fullImage,
      detected: false,
      method: "SAFE_FULL_FRAME",
      confidence: analysis.measurementConfidence,
      reviewStatus: manualCropSuggested
        ? IMAGE_REVIEW_STATUS.NEEDS_REVIEW
        : IMAGE_REVIEW_STATUS.APPROVED,
      reviewReason: manualCropSuggested ? "MANUAL_BOUNDS_RECOMMENDED" : null,
      manualCropSuggested,
      retainedContentRatio: 1,
      analysis,
    };
  }

  const expanded = expandBounds(analysis.bounds, width, height, cropPaddingRatio);
  const contentTouchesSourceEdge = analysis.bounds.left === 0 || analysis.bounds.top === 0
    || analysis.bounds.left + analysis.bounds.width === width
    || analysis.bounds.top + analysis.bounds.height === height;
  return {
    ...expanded,
    detected: true,
    method: "AUTO_CONTENT_BOUNDS",
    confidence: "HIGH",
    reviewStatus: contentTouchesSourceEdge
      ? IMAGE_REVIEW_STATUS.NEEDS_REVIEW
      : IMAGE_REVIEW_STATUS.APPROVED,
    reviewReason: contentTouchesSourceEdge ? "CONTENT_NEAR_SOURCE_EDGE" : null,
    manualCropSuggested: contentTouchesSourceEdge,
    retainedContentRatio: retainedBoundsRatio(analysis.bounds, expanded),
    analysis,
  };
}

export async function detectSmartProductBounds(input, {
  processingMode = IMAGE_PROCESSING_MODE.SMART_SAFE,
  crop,
  cropPaddingRatio = SMART_CROP_PADDING_RATIO,
} = {}) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const metadata = await sharp(source).metadata();
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (!width || !height) throw new Error("Не удалось определить размеры исходного изображения");
  const mode = resolveImageProcessingMode(processingMode);
  const fullImage = { left: 0, top: 0, width, height };

  if (mode === IMAGE_PROCESSING_MODE.PRODUCT_FOCUS) {
    return {
      ...normalizedManualCrop(crop, width, height),
      detected: true,
      method: "MANUAL",
      confidence: "MANUAL",
      reviewStatus: IMAGE_REVIEW_STATUS.APPROVED,
      reviewReason: null,
    };
  }
  if (mode !== IMAGE_PROCESSING_MODE.SMART_SAFE) {
    return {
      ...fullImage,
      detected: false,
      method: "LEGACY_FULL_IMAGE",
      confidence: "LEGACY",
      reviewStatus: IMAGE_REVIEW_STATUS.APPROVED,
      reviewReason: null,
    };
  }

  const border = await detectHighConfidenceBorderColour(source);
  if (!border.uniform) {
    return {
      ...fullImage,
      detected: false,
      method: "SAFE_FULL_IMAGE",
      confidence: "LOW",
      reviewStatus: IMAGE_REVIEW_STATUS.NEEDS_REVIEW,
      reviewReason: "NON_UNIFORM_OR_TEXTURED_BACKGROUND",
      borderAnalysis: { p90Distance: border.p90Distance, p98Distance: border.p98Distance },
    };
  }

  const trimmed = await sharp(source)
    .trim({ background: border.background, threshold: 10 })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.max(0, Math.min(width - 1, -(trimmed.info.trimOffsetLeft || 0)));
  const top = Math.max(0, Math.min(height - 1, -(trimmed.info.trimOffsetTop || 0)));
  const trimmedWidth = Math.min(Number(trimmed.info.width) || width, width - left);
  const trimmedHeight = Math.min(Number(trimmed.info.height) || height, height - top);
  const areaRatio = (trimmedWidth * trimmedHeight) / (width * height);
  if (trimmedWidth < 8 || trimmedHeight < 8 || areaRatio < 0.0025) {
    return {
      ...fullImage,
      detected: false,
      method: "SAFE_FULL_IMAGE",
      confidence: "LOW",
      reviewStatus: IMAGE_REVIEW_STATUS.NEEDS_REVIEW,
      reviewReason: "DETECTED_AREA_TOO_SMALL",
    };
  }
  if (areaRatio >= 0.97) {
    return {
      ...fullImage,
      detected: false,
      method: "SAFE_FULL_IMAGE",
      confidence: "HIGH",
      reviewStatus: IMAGE_REVIEW_STATUS.APPROVED,
      reviewReason: null,
    };
  }

  const expanded = expandBounds({
    left,
    top,
    width: trimmedWidth,
    height: trimmedHeight,
  }, width, height, cropPaddingRatio);
  const touchesSourceEdge = expanded.left === 0 || expanded.top === 0
    || expanded.left + expanded.width === width || expanded.top + expanded.height === height;
  return {
    ...expanded,
    detected: true,
    method: "UNIFORM_BORDER",
    confidence: "HIGH",
    reviewStatus: touchesSourceEdge
      ? IMAGE_REVIEW_STATUS.NEEDS_REVIEW
      : IMAGE_REVIEW_STATUS.APPROVED,
    reviewReason: touchesSourceEdge ? "SIGNIFICANT_CONTENT_NEAR_SOURCE_EDGE" : null,
    rawDetectedBounds: { left, top, width: trimmedWidth, height: trimmedHeight },
    borderAnalysis: { p90Distance: border.p90Distance, p98Distance: border.p98Distance },
  };
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

export async function normalizeSmartProductComposition(input, {
  processingMode = IMAGE_PROCESSING_MODE.SMART_SAFE,
  crop,
  frameFillRatio = SMART_FRAME_FILL_RATIO,
  cropPaddingRatio = SMART_CROP_PADDING_RATIO,
  maxUpscale = MAX_UPSCALE,
} = {}) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const mode = resolveImageProcessingMode(processingMode);
  const bounds = await detectSmartProductBounds(source, {
    processingMode: mode,
    crop,
    cropPaddingRatio,
  });
  const scale = Math.min(
    (PROCESSED_IMAGE_SIZE * frameFillRatio) / bounds.width,
    (PROCESSED_IMAGE_SIZE * frameFillRatio) / bounds.height,
    maxUpscale,
  );
  const contentWidth = Math.max(1, Math.round(bounds.width * scale));
  const contentHeight = Math.max(1, Math.round(bounds.height * scale));
  const cropped = await sharp(source)
    .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
    .resize({ width: contentWidth, height: contentHeight, fit: "fill" })
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
      input: cropped,
      left: Math.floor((PROCESSED_IMAGE_SIZE - contentWidth) / 2),
      top: Math.floor((PROCESSED_IMAGE_SIZE - contentHeight) / 2),
    }])
    .png()
    .toBuffer();

  return {
    baseCanvas,
    bounds,
    scale,
    contentWidth,
    contentHeight,
    preparedWidth: contentWidth,
    preparedHeight: contentHeight,
    fillRatio: Math.max(contentWidth, contentHeight) / PROCESSED_IMAGE_SIZE,
    processingMode: mode,
  };
}

export async function normalizeProductMaxComposition(input, {
  crop,
  cropPaddingRatio = PRODUCT_MAX_CROP_PADDING_RATIO,
  targetFillRatio = PRODUCT_MAX_TARGET_FILL_RATIO,
  safeFrameFillRatio = PRODUCT_MAX_SAFE_FRAME_FILL_RATIO,
} = {}) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const bounds = await detectProductMaxBounds(source, { crop, cropPaddingRatio });
  const contentBounds = bounds.analysis.bounds;
  const contentLongestSide = Math.max(contentBounds.width, contentBounds.height);
  const sourceLongestSide = Math.max(bounds.analysis.sourceWidth, bounds.analysis.sourceHeight);
  const originalContentFillRatio = contentLongestSide / sourceLongestSide;
  const desiredContentFillRatio = Math.max(
    targetFillRatio,
    Math.min(safeFrameFillRatio, originalContentFillRatio),
  );
  const targetScale = (PROCESSED_IMAGE_SIZE * desiredContentFillRatio)
    / Math.max(1, contentLongestSide);
  const frameScale = Math.min(
    PROCESSED_IMAGE_SIZE / bounds.width,
    PROCESSED_IMAGE_SIZE / bounds.height,
  );
  const safeFullFrameScale = Math.min(
    (PROCESSED_IMAGE_SIZE * safeFrameFillRatio) / bounds.width,
    (PROCESSED_IMAGE_SIZE * safeFrameFillRatio) / bounds.height,
  );
  const canUseContentMeasurement = bounds.analysis.measurementConfidence !== "LOW";
  const scale = bounds.method === "SAFE_FULL_FRAME"
    ? originalContentFillRatio >= targetFillRatio ? frameScale : safeFullFrameScale
    : canUseContentMeasurement
      ? Math.min(targetScale, frameScale)
      : Math.min(safeFullFrameScale, frameScale);
  const contentWidth = Math.max(1, Math.round(bounds.width * scale));
  const contentHeight = Math.max(1, Math.round(bounds.height * scale));
  const cropped = await sharp(source)
    .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
    .resize({ width: contentWidth, height: contentHeight, fit: "fill" })
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
      input: cropped,
      left: Math.floor((PROCESSED_IMAGE_SIZE - contentWidth) / 2),
      top: Math.floor((PROCESSED_IMAGE_SIZE - contentHeight) / 2),
    }])
    .png()
    .toBuffer();
  const visibleContent = intersectBounds(contentBounds, bounds);
  const contentFillRatio = Math.min(
    1,
    Math.max(visibleContent.width, visibleContent.height) * scale / PROCESSED_IMAGE_SIZE,
  );

  return {
    baseCanvas,
    bounds,
    scale,
    contentWidth,
    contentHeight,
    preparedWidth: contentWidth,
    preparedHeight: contentHeight,
    fillRatio: Math.max(contentWidth, contentHeight) / PROCESSED_IMAGE_SIZE,
    contentFillRatio,
    originalContentFillRatio,
    desiredContentFillRatio,
    retainedContentRatio: bounds.retainedContentRatio,
    contentBounds,
    manualCropSuggested: bounds.manualCropSuggested,
    processingMode: IMAGE_PROCESSING_MODE.PRODUCT_MAX,
  };
}

async function prepareBaseCanvas(input, {
  processingMode = IMAGE_PROCESSING_MODE.LEGACY,
  crop,
  cropPaddingRatio,
} = {}) {
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
  const mode = resolveImageProcessingMode(processingMode);
  const composition = mode === IMAGE_PROCESSING_MODE.LEGACY
    ? await normalizeProductComposition(normalized.data)
    : mode === IMAGE_PROCESSING_MODE.PRODUCT_MAX
      ? await normalizeProductMaxComposition(normalized.data, { crop, cropPaddingRatio })
      : await normalizeSmartProductComposition(normalized.data, {
        processingMode: mode,
        crop,
        cropPaddingRatio,
      });

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
      contentFillRatio: composition.contentFillRatio ?? composition.fillRatio,
      originalContentFillRatio: composition.originalContentFillRatio ?? null,
      targetContentFillRatio: composition.desiredContentFillRatio ?? null,
      retainedContentRatio: composition.retainedContentRatio ?? 1,
      manualCropSuggested: composition.manualCropSuggested ?? false,
      contentBounds: composition.contentBounds || null,
      upscaleRatio: Math.max(1, composition.scale),
      autoCropApplied: composition.bounds.detected,
      processingMode: mode,
      processingVersion: mode === IMAGE_PROCESSING_MODE.LEGACY
        ? PRODUCT_IMAGE_PROCESSING_VERSION
        : mode === IMAGE_PROCESSING_MODE.PRODUCT_MAX
          ? PRODUCT_MAX_IMAGE_PROCESSING_VERSION
          : SMART_PRODUCT_IMAGE_PROCESSING_VERSION,
      detectionMethod: composition.bounds.method || "LEGACY_UNIFORM_BORDER",
      detectionConfidence: composition.bounds.confidence || "LEGACY",
      reviewStatus: composition.bounds.reviewStatus || IMAGE_REVIEW_STATUS.APPROVED,
      reviewReason: composition.bounds.reviewReason || null,
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
  return encodeWebpWithQuality(master, size, WEBP_QUALITY);
}

async function encodeWebpWithQuality(master, size, quality) {
  return sharp(master)
    .resize({ width: size, height: size, fit: "fill", withoutEnlargement: true })
    .webp({ quality, effort: 5, smartSubsample: true })
    .toBuffer();
}

async function encodeMerchantBranch(baseCanvas, metadata, quality = WEBP_QUALITY) {
  return {
    variant: await encodeWebpWithQuality(baseCanvas, PROCESSED_IMAGE_SIZE, quality),
    metadata: {
      ...metadata,
      brandingMode: IMAGE_BRANDING_MODE.CLEAN,
      brandingLayers: [],
    },
  };
}

export async function processMerchantProductImage(input, options = {}) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const mode = resolveImageProcessingMode(options.processingMode);
  const { baseCanvas, metadata } = await prepareBaseCanvas(source, options);
  return encodeMerchantBranch(
    baseCanvas,
    metadata,
    mode === IMAGE_PROCESSING_MODE.LEGACY ? WEBP_QUALITY : SMART_WEBP_QUALITY,
  );
}

export async function processProductImage(input, {
  brandingMode,
  processingMode,
  crop,
  cropPaddingRatio,
} = {}) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const mode = resolveImageProcessingMode(processingMode);
  const resolvedBrandingMode = resolveImageBrandingMode(brandingMode);
  const { baseCanvas, metadata } = await prepareBaseCanvas(source, {
    processingMode: mode,
    crop,
    cropPaddingRatio,
  });
  const branded = await applyBranding(baseCanvas, resolvedBrandingMode);
  const sizes = [PROCESSED_IMAGE_SIZE, ...RESPONSIVE_SIZES];
  const outputQuality = mode === IMAGE_PROCESSING_MODE.LEGACY
    ? WEBP_QUALITY
    : SMART_WEBP_QUALITY;
  const [encoded, separateMerchant] = await Promise.all([
    Promise.all(
      sizes.map(async (size) => [
        size,
        await encodeWebpWithQuality(branded.image, size, outputQuality),
      ]),
    ),
    resolvedBrandingMode === IMAGE_BRANDING_MODE.CLEAN
      ? Promise.resolve(null)
      : encodeMerchantBranch(baseCanvas, metadata, outputQuality),
  ]);
  const variants = Object.fromEntries(encoded);

  return {
    variants,
    merchant: separateMerchant || {
      variant: variants[PROCESSED_IMAGE_SIZE],
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
  processMerchant: processMerchantProductImage,
};
