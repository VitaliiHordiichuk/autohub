import { lookupSpecialOrderArticle } from "./SpecialOrderLookupService.js";
import { isEligiblePublicOffer } from "./OfferService.js";

// Separate inquiry, never an inventory offer/product/cart item.
const DEFAULT_NAME = Object.freeze({
  uk: "Запчастина для Mercedes-Benz",
  ru: "Запчасти на Mercedes-Benz",
  en: "Mercedes-Benz spare part",
});

export function specialOrderFallbackEnabled() {
  return /^(?:true|1|on|yes)$/i.test(
    String(process.env.SPECIAL_ORDER_TXT_FALLBACK_ENABLED || "false")
  );
}

export function hasEligibleWebsiteOffers(publicResult) {
  const seen = new Set();
  const stack = [
    publicResult?.productCard,
    publicResult?.replacementSourceCard,
    ...(publicResult?.family || []),
  ];
  while (stack.length > 0) {
    const card = stack.pop();
    if (!card || typeof card !== "object" || seen.has(card)) continue;
    seen.add(card);
    if (Array.isArray(card.offers) &&
      card.offers.some(isEligiblePublicOffer)) return true;
    if (Array.isArray(card.analogs)) stack.push(...card.analogs);
    if (Array.isArray(card.replacements)) stack.push(...card.replacements);
  }
  return false;
}

/**
 * Must run only after the website search has resolved its *public* offers.
 * When catalogue lookup has no match, publicResult may be null.
 * If a catalogue item was found but public offers were not evaluated,
 * fail closed instead of unexpectedly showing a TXT price.
 */
export async function readSpecialOrderFallback({
  article, requestedLocale = "uk", pricingContext,
  searchResult = null, publicResult = null,
}, deps = {}) {
  const enabled = deps.enabled === undefined
    ? specialOrderFallbackEnabled()
    : deps.enabled === true;
  if (!enabled) return null;
  if (searchResult?.found && !publicResult) return null;
  if (hasEligibleWebsiteOffers(publicResult)) return null;
  const lookup = deps.lookup || lookupSpecialOrderArticle;
  let candidates;
  try {
    candidates = await lookup({
      article,
      priceGroupName: pricingContext?.priceGroupName || "Guest",
    });
  } catch (error) {
    // Feature is optional; an unavailable TXT revision cannot break
    // existing website/Telegram warehouse search.
    console.error("Special-order TXT fallback unavailable:", error.message);
    return null;
  }
  if (!Array.isArray(candidates) || candidates.length !== 1) return null;
  const candidate = candidates[0];
  if (candidate.status !== "SPECIAL_ORDER_INQUIRY" ||
      !Number.isFinite(candidate.priceUah) || candidate.priceUah <= 0 ||
      candidate.currency !== "UAH" ||
      candidate.requiresManagerConfirmation !== true) return null;

  const locale = Object.hasOwn(DEFAULT_NAME, requestedLocale)
    ? requestedLocale : "uk";
  return {
    source: "MERCEDES_TXT",
    article: candidate.article,
    name: candidate.name || DEFAULT_NAME[locale],
    status: "SPECIAL_ORDER_INQUIRY",
    priceUah: candidate.priceUah,
    currency: "UAH",
    isEstimated: true,
    isAvailable: false,
    checkoutEligible: false,
    requiresManagerConfirmation: true,
  };
}
