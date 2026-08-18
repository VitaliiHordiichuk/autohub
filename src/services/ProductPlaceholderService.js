import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import sharp from "sharp";

const PLACEHOLDER_VERSION = "maka-product-placeholder-v1";
const PLACEHOLDER_SIZE = 800;
const MAX_CACHE_ENTRIES = 250;
const assetsDirectory = new URL("../assets/placeholders/", import.meta.url);
const logoUrl = new URL("../assets/product-watermark.svg", import.meta.url);
const renderedCache = new Map();
const assetCache = new Map();

const TEMPLATE_RULES = [
  ["filter", /(?:фільтр|фильтр|filter)/iu],
  ["seal", /(?:сальник|seal|кільц|кольц)/iu],
  ["gasket", /(?:проклад|gasket|ущільнен|уплотнен)/iu],
  ["belt", /(?:ремін|ремень|belt)/iu],
];

function cleanText(value, fallback = "") {
  return String(value ?? fallback)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeXml(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function categoryText(product) {
  const category = product?.category;
  const categoryValue = category && typeof category === "object"
    ? [category.name, category.name_uk, category.name_ru, category.name_en]
    : [category];
  return [
    ...categoryValue,
    product?.productType,
    product?.product_type,
    product?.name,
  ].map((value) => cleanText(value)).filter(Boolean).join(" ");
}

function templateFor(product) {
  const source = categoryText(product);
  return TEMPLATE_RULES.find(([, rule]) => rule.test(source))?.[0] || "default";
}

function splitLongWord(word, maxCharacters) {
  const chunks = [];
  for (let index = 0; index < word.length; index += maxCharacters) {
    chunks.push(word.slice(index, index + maxCharacters));
  }
  return chunks;
}

function wrapText(value, maxCharacters = 31, maxLines = 2) {
  const words = cleanText(value, "Автозапчастина")
    .split(" ")
    .flatMap((word) => word.length > maxCharacters ? splitLongWord(word, maxCharacters) : [word]);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharacters) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  const usedWords = lines.join(" ").length;
  const original = cleanText(value, "Автозапчастина");
  if (original.length > usedWords && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
  }
  return lines;
}

function articleKey(product) {
  return cleanText(
    product?.article_normalized
      || product?.normalizedArticle
      || product?.article,
  ).toUpperCase();
}

function realImageUrls(product) {
  const imageUrls = Array.isArray(product?.imageUrls) ? product.imageUrls : [];
  const candidates = [
    ...imageUrls,
    product?.image_url,
    product?.imageUrl,
  ];
  return [...new Set(candidates
    .map((value) => cleanText(value))
    .filter((value) => value && !isProductPlaceholderUrl(value)))];
}

function productPlaceholderUrl(product) {
  const key = articleKey(product);
  if (!key) return null;
  return `/api/products/${encodeURIComponent(key)}/placeholder`;
}

function isProductPlaceholderUrl(value) {
  return /\/api\/products\/[^/?#]+\/placeholder(?:[?#]|$)/i.test(String(value || ""));
}

function getProductImage(product) {
  const images = realImageUrls(product);
  if (images.length) {
    return {
      imageUrl: images[0],
      imageUrls: images,
      hasRealImage: true,
      isPlaceholder: false,
    };
  }
  return {
    imageUrl: productPlaceholderUrl(product),
    imageUrls: [],
    hasRealImage: false,
    isPlaceholder: true,
  };
}

function productIdentity(product) {
  return {
    article: cleanText(product?.article, articleKey(product) || "MAKA"),
    brand: cleanText(
      product?.brand
        || product?.brand_name
        || product?.manufacturer,
      "MAKA Selection",
    ),
    name: cleanText(product?.name, "Автозапчастина"),
    template: templateFor(product),
  };
}

function placeholderEtag(product) {
  const identity = productIdentity(product);
  const digest = createHash("sha256")
    .update(JSON.stringify({ version: PLACEHOLDER_VERSION, ...identity }))
    .digest("base64url")
    .slice(0, 24);
  return `"${digest}"`;
}

async function loadAsset(name) {
  if (!assetCache.has(name)) {
    const url = name === "logo"
      ? logoUrl
      : new URL(`${name}.svg`, assetsDirectory);
    assetCache.set(name, readFile(url));
  }
  return assetCache.get(name);
}

function textOverlay(product) {
  const identity = productIdentity(product);
  const article = escapeXml(identity.article);
  const brand = escapeXml(identity.brand.slice(0, 48));
  const nameLines = wrapText(identity.name).map(escapeXml);
  const articleSize = identity.article.length > 22 ? 42 : identity.article.length > 15 ? 48 : 56;
  const nameMarkup = nameLines.map((line, index) => (
    `<text x="400" y="${600 + index * 43}" text-anchor="middle" class="name">${line}</text>`
  )).join("");

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0b1d2a"/>
          <stop offset="1" stop-color="#07131d"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="38%" r="55%">
          <stop offset="0" stop-color="#173448" stop-opacity=".9"/>
          <stop offset="1" stop-color="#07131d" stop-opacity="0"/>
        </radialGradient>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0v40" fill="none" stroke="#294051" stroke-width="1" opacity=".24"/>
        </pattern>
        <style>
          text { font-family: "DejaVu Sans", Arial, sans-serif; }
          .article { fill:#f3f6f8; font-size:${articleSize}px; font-weight:800; letter-spacing:1px; }
          .brand { fill:#d7a758; font-size:26px; font-weight:700; }
          .name { fill:#c8d3db; font-size:29px; font-weight:500; }
          .site { fill:#f0bd69; font-size:24px; font-weight:800; letter-spacing:2px; }
        </style>
      </defs>
      <rect width="800" height="800" fill="url(#bg)"/>
      <rect width="800" height="800" fill="url(#glow)"/>
      <rect x="20" y="20" width="760" height="760" rx="34" fill="none" stroke="#263b4a" stroke-width="2"/>
      <rect x="42" y="42" width="716" height="716" rx="24" fill="url(#grid)"/>
      <path d="M92 449h616" stroke="#263b4a" stroke-width="2"/>
      <circle cx="400" cy="310" r="154" fill="#0a1822" stroke="#253d4f" stroke-width="2"/>
      <text x="400" y="497" text-anchor="middle" class="article">${article}</text>
      <text x="400" y="545" text-anchor="middle" class="brand">${brand}</text>
      ${nameMarkup}
      <path d="M274 709h252" stroke="#8e6b35" stroke-width="2"/>
      <text x="400" y="750" text-anchor="middle" class="site">MAKA.com.ua</text>
    </svg>
  `);
}

function rememberRendered(key, value) {
  if (renderedCache.has(key)) renderedCache.delete(key);
  renderedCache.set(key, value);
  while (renderedCache.size > MAX_CACHE_ENTRIES) {
    renderedCache.delete(renderedCache.keys().next().value);
  }
}

async function generatePlaceholder(product) {
  const etag = placeholderEtag(product);
  if (renderedCache.has(etag)) {
    const cached = renderedCache.get(etag);
    renderedCache.delete(etag);
    renderedCache.set(etag, cached);
    return cached;
  }

  const identity = productIdentity(product);
  const [silhouette, logo] = await Promise.all([
    loadAsset(identity.template),
    loadAsset("logo"),
  ]);
  const [renderedSilhouette, renderedLogo] = await Promise.all([
    sharp(silhouette).resize({ width: 330, height: 215, fit: "contain" }).png().toBuffer(),
    sharp(logo).resize({ width: 310, fit: "inside" }).png().toBuffer(),
  ]);
  const buffer = await sharp(textOverlay(product), { density: 144 })
    .resize({ width: PLACEHOLDER_SIZE, height: PLACEHOLDER_SIZE })
    .composite([
      { input: renderedLogo, left: 245, top: 57 },
      { input: renderedSilhouette, left: 235, top: 202 },
    ])
    .webp({ quality: 86, effort: 5, smartSubsample: true })
    .toBuffer();
  const rendered = { buffer, etag, template: identity.template };
  rememberRendered(etag, rendered);
  return rendered;
}

export const ProductPlaceholderService = {
  generatePlaceholder,
  getProductImage,
  isProductPlaceholderUrl,
  placeholderEtag,
  productPlaceholderUrl,
  templateFor,
};
