import { normalizeArticle } from "./articleEngine/normalize.js";
import { ArticleNumberRepository } from "../repositories/ArticleNumberRepository.js";
import { OfferService } from "./OfferService.js";

export async function findPreviousArticleProducts({ article, searchResult }, deps = {}) {
  const normalized = normalizeArticle(article);
  if (!normalized || normalized.length > 255) return [];
  const candidates = new Set([normalized]);
  if (/^\d{10}$/.test(normalized)) candidates.add(`A${normalized}`);
  if (/^\d{8}$/.test(normalized)) candidates.add(`B${normalized}`);
  if (/^\d{12,}$/.test(normalized)) candidates.add(`N${normalized}`);
  // Prefix matches are suggestions, not proof of the requested brand/number.
  const exact = searchResult?.numberResolution !== "PREFIX"
    ? searchResult?.exactProduct : null;
  const brandId = Number(exact?.brand_id) || null;
  if (exact?.article_normalized) candidates.add(exact.article_normalized);
  const find = deps.find || (args => ArticleNumberRepository.findPreviousReplacementProducts(args));
  return find({ articleCandidates: [...candidates], brandId });
}

export async function buildPreviousArticleCards(products, pricingContext, availabilityContext, deps = {}) {
  if (!products.length) return [];
  const getOffers = deps.getOffers || ((...args) => OfferService.getOffersByProductIds(...args));
  const offers = await getOffers(products.map(p => Number(p.id)), pricingContext, "uk", availabilityContext);
  return products.map(product => ({ product, offers: offers.get(Number(product.id)) || [] }));
}

// Previous numbers remain separate stock offers. Never turn a reserved,
// unavailable or supplier-only previous number into a warehouse alternative.
export function availablePreviousArticleCards(cards = []) {
  return cards.map(card => ({ ...card, offers: (card.offers || []).filter(offer =>
    offer.sourceType === "OWN_STOCK" && offer.isAvailable === true &&
    Number(offer.quantity) > 0 && Number(offer.retailPrice) > 0),
  })).filter(card => card.offers.length > 0);
}
