import { pool } from "../config/db.js";
import { GoogleMerchantFeedRepository } from "../repositories/GoogleMerchantFeedRepository.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { presentOffers } from "./OfferService.js";
import { publicProductName } from "./ProductNameService.js";
import { ProductPlaceholderService } from "./ProductPlaceholderService.js";


const SITE_URL = "https://maka.com.ua";
const FEED_TITLE = "MAKA";
const FEED_DESCRIPTION = "MAKA product feed for Google Merchant Center";


function decodeHtmlEntities(value) {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
  ]);

  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => {
      const point = Number(code);
      return Number.isInteger(point)
        && point > 0
        && point <= 0x10ffff
        && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isInteger(point)
        && point > 0
        && point <= 0x10ffff
        && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : " ";
    })
    .replace(/&([a-z]+);/gi, (match, name) =>
      named.get(name.toLowerCase()) ?? match);
}


export function cleanMerchantText(value) {
  return decodeHtmlEntities(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function cleanMerchantDescription(value) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


export function escapeMerchantXml(value) {
  return cleanMerchantText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


function comparable(value) {
  return cleanMerchantText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("uk")
    .replace(/[^\p{L}\p{N}]/gu, "");
}


export function buildMerchantTitle({ brand, name, article }) {
  const safeBrand = cleanMerchantText(brand);
  const safeName = cleanMerchantText(name);
  const safeArticle = cleanMerchantText(article);
  const normalizedName = comparable(safeName);
  const parts = [];

  if (safeBrand && !normalizedName.includes(comparable(safeBrand))) {
    parts.push(safeBrand);
  }
  if (safeName) parts.push(safeName);
  if (safeArticle && !normalizedName.includes(comparable(safeArticle))) {
    parts.push(safeArticle);
  }

  return cleanMerchantText(parts.join(" ")).slice(0, 150).trim();
}


function buildMerchantDescription({ description, name, brand, article }) {
  const existing = cleanMerchantDescription(description);
  if (existing) return existing.slice(0, 5000).trim();

  const safeName = cleanMerchantText(name).replace(/[.!?]+$/u, "");
  return cleanMerchantText(
    `${safeName}. Бренд: ${cleanMerchantText(brand)}. Артикул: ${cleanMerchantText(article)}.`
  ).slice(0, 5000).trim();
}


export function isPublicMerchantImage(value) {
  const source = cleanMerchantText(value);
  if (!source || ProductPlaceholderService.isProductPlaceholderUrl(source)) return false;

  try {
    const url = new URL(source);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && hostname !== "localhost"
      && hostname !== "127.0.0.1"
      && hostname !== "::1";
  } catch {
    return false;
  }
}


function isEligibleOfferRow(row) {
  return row?.is_available === true
    && row?.is_hidden !== true
    && row?.warehouse_active !== false
    && row?.supplier_active !== false
    && Number(row?.quantity) > 0;
}


function groupCandidates(rows) {
  const products = new Map();

  for (const row of rows || []) {
    const productId = Number(row?.merchant_product_id);
    if (!Number.isInteger(productId) || productId <= 0) continue;
    if (!products.has(productId)) products.set(productId, []);
    products.get(productId).push(row);
  }

  return products;
}


export function buildGoogleMerchantItems(
  rows,
  pricingContext = {
    discountPercent: 0,
    isVip: false,
    priceGroupName: "Guest",
  }
) {
  const items = [];

  for (const [productId, productRows] of groupCandidates(rows)) {
    const product = productRows[0];
    const article = cleanMerchantText(product.merchant_article);
    const brand = cleanMerchantText(product.merchant_brand);
    if (!article || !brand) continue;

    const images = [...new Set(
      (Array.isArray(product.merchant_image_urls)
        ? product.merchant_image_urls
        : [])
        .filter(isPublicMerchantImage)
    )].slice(0, 11);
    if (!images.length) continue;

    const offers = presentOffers(
      productRows.filter(isEligibleOfferRow),
      pricingContext,
      "uk"
    )
      .filter((offer) =>
        offer.isAvailable
        && Number(offer.quantity) > 0
        && Number(offer.retailPrice) > 0)
      .sort((first, second) =>
        Number(first.retailPrice) - Number(second.retailPrice));
    const offer = offers[0];
    if (!offer) continue;

    const name = publicProductName(
      product.merchant_name,
      product.merchant_name_provider
    );
    const title = buildMerchantTitle({ brand, name, article });
    if (!title) continue;

    items.push({
      id: `maka-${productId}`,
      title,
      description: buildMerchantDescription({
        description: product.merchant_description,
        name,
        brand,
        article,
      }),
      link: `${SITE_URL}/uk/product/${encodeURIComponent(article)}`,
      imageLink: images[0],
      additionalImageLinks: images.slice(1),
      availability: "in_stock",
      price: `${Number(offer.retailPrice).toFixed(2)} UAH`,
      condition: "new",
      brand,
      mpn: article,
    });
  }

  return items;
}


function merchantElement(name, value) {
  return `      <g:${name}>${escapeMerchantXml(value)}</g:${name}>`;
}


export function renderGoogleMerchantFeed(items) {
  const renderedItems = (items || []).map((item) => [
    "    <item>",
    merchantElement("id", item.id),
    merchantElement("title", item.title),
    merchantElement("description", item.description),
    merchantElement("link", item.link),
    merchantElement("image_link", item.imageLink),
    ...(item.additionalImageLinks || []).map((image) =>
      merchantElement("additional_image_link", image)),
    merchantElement("availability", item.availability),
    merchantElement("price", item.price),
    merchantElement("condition", item.condition),
    merchantElement("brand", item.brand),
    merchantElement("mpn", item.mpn),
    "    </item>",
  ].join("\n")).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">',
    "  <channel>",
    `    <title>${escapeMerchantXml(FEED_TITLE)}</title>`,
    `    <link>${escapeMerchantXml(`${SITE_URL}/uk`)}</link>`,
    `    <description>${escapeMerchantXml(FEED_DESCRIPTION)}</description>`,
    renderedItems,
    "  </channel>",
    "</rss>",
  ].filter(Boolean).join("\n");
}


export const GoogleMerchantFeedService = {
  async getItems(db = pool, options = {}) {
    const pricingContext =
      await CustomerPricingService.getContext(
        null,
        db
      );
    const rows =
      await GoogleMerchantFeedRepository.findCandidates(
        db,
        options
      );

    return buildGoogleMerchantItems(
      rows,
      pricingContext
    );
  },

  async generateXml(db = pool) {
    return renderGoogleMerchantFeed(
      await this.getItems(db)
    );
  },
};
