import { OfferService } from "./OfferService.js";
import { PublicSearchPresenterService } from "./PublicSearchPresenterService.js";

// The private MAKAtron staff bridge can show every eligible article in the
// website's canonical search family, not just the supplier-filtered public
// subset. Never attach this field to a public website/client/guest response.
export async function websiteStaffVariants(read, deps = {}) {
  if (!read?.found) return [];
  const exact = read.searchResult?.exactProduct;
  const all = [exact, ...(read.searchResult?.family || [])];
  const seen = new Set();
  const products = all.filter(product => {
    const id = Number(product?.id);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (!products.length) return [];

  // Use the website's same offer eligibility, inventory reservations, and
  // pricing engine; do not introduce a Telegram-specific catalogue matcher.
  const load = deps.getOffers || ((ids) =>
    OfferService.getOffersByProductIds(
      ids, { discountPercent: 0, isVip: false }, "uk",
      { userId: null, cartId: null }
    ));
  const map = await load(products.map(p => Number(p.id)));
  const cards = products.map(product => ({
    product,
    offers: map.get(Number(product.id)) || []
  })).filter(card => card.offers.some(offer =>
    offer.isAvailable === true && Number(offer.quantity) > 0 &&
    Number(offer.retailPrice) > 0
  ));
  if (!cards.length) return [];

  const present = deps.present || PublicSearchPresenterService.present;
  const localized = await present({
    requestedLocale: read.response?.locale || "uk",
    family: cards,
    productCard: null,
    includeSourceDetails: true
  });
  return localized.family || [];
}
