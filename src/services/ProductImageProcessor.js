import { readFile } from "node:fs/promises";
import sharp from "sharp";

const MASTER_SIZE = 1600;
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

async function createMaster(input) {
  const oriented = await sharp(input, { failOn: "warning", limitInputPixels: 80_000_000 })
    .rotate()
    .toColorspace("srgb")
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const photo = await sharp(oriented)
    .resize({ width: MASTER_SIZE, height: MASTER_SIZE, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  const photoMeta = await sharp(photo).metadata();
  const width = photoMeta.width || MASTER_SIZE;
  const height = photoMeta.height || MASTER_SIZE;
  const logo = await readFile(logoPath);
  const logoDataUri = `data:image/svg+xml;base64,${logo.toString("base64")}`;

  return sharp(photo)
    .composite([
      { input: patternSvg(logoDataUri, width, height), left: 0, top: 0 },
      { input: protectionSvg(width, height), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function encodeWebp(master, size) {
  const quality = size >= 1200 ? 84 : size >= 800 ? 82 : 78;
  return sharp(master)
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: false })
    .webp({ quality, effort: 5, smartSubsample: true })
    .toBuffer();
}

export const ProductImageProcessor = {
  async process(input) {
    const master = await createMaster(input);
    const sizes = [1600, 1200, 800, 400];
    const encoded = await Promise.all(sizes.map(async (size) => [size, await encodeWebp(master, size)]));
    return Object.fromEntries(encoded);
  },
};
