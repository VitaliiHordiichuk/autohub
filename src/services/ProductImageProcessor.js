import { readFile } from "node:fs/promises";
import sharp from "sharp";

export const PROCESSED_IMAGE_SIZE = 1500;
export const MAX_UPSCALE = 1.5;
export const WEBP_QUALITY = 89;

const RESPONSIVE_SIZES = [1200, 800, 400];
const logoPath = new URL("../assets/product-watermark.svg", import.meta.url);

function patternSvg(logoDataUri, width, height) {
  const tiles = [];
  const rows = Math.ceil(height / 245) + 2;
  const columns = Math.ceil(width / 360) + 2;
  for (let row = -1; row < rows; row += 1) {
    for (let column = -1; column < columns; column += 1) {
      const x = column * 360 + (row % 2 ? 180 : 0);
      const y = row * 245;
      tiles.push(`<image href="${logoDataUri}" x="${x}" y="${y}" width="285" height="77" opacity="0.45" transform="rotate(-18 ${x + 142} ${y + 38})"/>`);
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

export function calculateContainedDimensions(width, height) {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0
    || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new Error("Не удалось определить размеры исходного изображения");
  }

  const scale = Math.min(
    PROCESSED_IMAGE_SIZE / sourceWidth,
    PROCESSED_IMAGE_SIZE / sourceHeight,
    MAX_UPSCALE,
  );

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

async function createProcessedMaster(input) {
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
  const contained = calculateContainedDimensions(originalWidth, originalHeight);
  const resized = await sharp(normalized.data)
    .resize({
      width: contained.width,
      height: contained.height,
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.floor((PROCESSED_IMAGE_SIZE - resized.info.width) / 2);
  const top = Math.floor((PROCESSED_IMAGE_SIZE - resized.info.height) / 2);
  const logo = await readFile(logoPath);
  const logoDataUri = `data:image/svg+xml;base64,${logo.toString("base64")}`;

  const master = await sharp({
    create: {
      width: PROCESSED_IMAGE_SIZE,
      height: PROCESSED_IMAGE_SIZE,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      { input: resized.data, left, top },
      { input: patternSvg(logoDataUri, PROCESSED_IMAGE_SIZE, PROCESSED_IMAGE_SIZE), left: 0, top: 0 },
      { input: protectionSvg(PROCESSED_IMAGE_SIZE, PROCESSED_IMAGE_SIZE), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  return {
    master,
    metadata: {
      originalWidth,
      originalHeight,
      processedWidth: PROCESSED_IMAGE_SIZE,
      processedHeight: PROCESSED_IMAGE_SIZE,
      contentWidth: resized.info.width,
      contentHeight: resized.info.height,
      scale: contained.scale,
      qualityStatus: classifyImageQuality(originalWidth, originalHeight),
    },
  };
}

async function encodeWebp(master, size) {
  return sharp(master)
    .resize({ width: size, height: size, fit: "fill", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 5, smartSubsample: true })
    .toBuffer();
}

export async function processProductImage(input) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const { master, metadata } = await createProcessedMaster(source);
  const sizes = [PROCESSED_IMAGE_SIZE, ...RESPONSIVE_SIZES];
  const encoded = await Promise.all(
    sizes.map(async (size) => [size, await encodeWebp(master, size)]),
  );

  return {
    variants: Object.fromEntries(encoded),
    metadata,
  };
}

export const ProductImageProcessor = {
  process: processProductImage,
};
