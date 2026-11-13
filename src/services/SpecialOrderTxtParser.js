import { specialOrderArticle } from "./SpecialOrderArticlePolicy.js";
import {
  calculateSpecialOrderPrice,
  specialOrderDiscountGroup,
} from "./SpecialOrderPricingService.js";

// Positions refer to decoded Unicode CHARACTER offsets, not UTF-8 bytes.
// Based on user-supplied 32-line fixed-width TXT sample (November 2026).
const FIELDS = Object.freeze({
  secondArticle: [21, 41],
  primaryName: [42, 72],
  localizedName: [72, 102],
  groups: [102, 126],
  retailExVatUah: [196, 215],
});

function readField(line, [start, end]) {
  return line.slice(start, end).trim();
}

function secondDiscountGroup(line) {
  const [start, end] = FIELDS.groups;
  const segment = line.slice(start, end);

  // Group slots occupy positions 102..105 and 106..125. NEVER read
  // segment.slice(4) alone: 'evo220' at 102 would falsely look like '20'.
  // Find complete tokens by their ACTUAL start positions.
  const tokens = [...segment.matchAll(/\S+/g)];
  if (tokens.length === 0) return null;

  const inSecondSlot = tokens.filter(match => match.index >= 4);
  if (inSecondSlot.length !== 1) return null;

  const token = inSecondSlot[0][0];
  return specialOrderDiscountGroup(token);
}

/**
 * Parse one decoded fixed-width line and return an import candidate or
 * a rejection reason. Neither rejected nor imported records become
 * publicly available product/offer listings.
 */
export function parseSpecialOrderTxtLine(line) {
  if (typeof line !== "string" || line.length < 215) {
    return { ok: false, reason: "INVALID_LINE" };
  }

  const article = specialOrderArticle(readField(line, FIELDS.secondArticle));
  if (!article) return { ok: false, reason: "INVALID_OR_TRAILING_W_ARTICLE" };

  const group = secondDiscountGroup(line);
  if (!group) return { ok: false, reason: "DISCOUNT_GROUP_EXCLUDED" };

  const price = readField(line, FIELDS.retailExVatUah);
  const calculated = calculateSpecialOrderPrice({
    retailPriceExVatUah: price,
    secondDiscountGroup: group,
    priceGroupName: "Guest",
  });
  if (!calculated) return { ok: false, reason: "INVALID_PRICE" };

  const title = readField(line, FIELDS.localizedName) ||
    readField(line, FIELDS.primaryName) || null;

  return {
    ok: true,
    record: {
      article: article.article,
      articleNormalized: article.normalized,
      title,
      discountGroup: group,
      retailExVatUah: price.replace(",", "."),
      isTool: article.isTool,
    },
  };
}
