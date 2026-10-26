import { readWebsiteArticleSearch } from "../services/WebsiteArticleSearchService.js";
import {
  SearchAnalyticsService,
} from "../services/SearchAnalyticsService.js";
import { CustomerPricingService } from "../services/CustomerPricingService.js";
import { PublicSearchSuggestionRepository } from "../repositories/PublicSearchSuggestionRepository.js";
import { cleanPublicSearchQuery } from "../services/PublicSearchQuery.js";
import { OfferService } from "../services/OfferService.js";
import { PublicAvailabilityContextService } from "../services/PublicAvailabilityContextService.js";

export async function searchByText(req, res) {
  const query = cleanPublicSearchQuery(req.query.q);
  if (!query) return res.status(400).json({ success: false, error: "Введіть запит від 2 до 255 символів" });
  const locale = ["uk", "en", "ru"].includes(req.query.locale) ? req.query.locale : "uk";
  try {
    res.set("Cache-Control", "private, no-store");
    const [matches, pricingContext, availabilityContext] = await Promise.all([
      PublicSearchSuggestionRepository.search({ query, locale, page: req.query.page }),
      CustomerPricingService.getContext(req.auth?.userId ?? null),
      PublicAvailabilityContextService.fromRequest(req),
    ]);
    const offersByProductId = await OfferService.getOffersByProductIds(
      matches.products.map((product) => product.id),
      pricingContext,
      locale,
      availabilityContext,
    );
    const products = matches.products.map(product => {
      const offers = offersByProductId.get(Number(product.id)) || [];
      return { ...product, offers: offers.map(offer => ({
        id: offer.id, retailPrice: offer.retailPrice, isAvailable: offer.isAvailable,
        availabilityStatus: offer.availabilityStatus,
        reservationExpiresAt: offer.reservationExpiresAt,
        availabilityText: offer.availabilityText, sourceLabel: offer.sourceLabel,
        sourceType: offer.sourceType,
        warehouseCity: offer.sourceType === "OWN_STOCK" ? offer.warehouseCity || null : null,
      })) };
    });
    // Pagination continues the same search instead of creating another event.
    if (matches.pagination.page === 1) await SearchAnalyticsService.recordSearch({
      req, article: query, requestedLocale: locale,
      searchResult: { normalized: query.toLowerCase(), rule: "TEXT", found: matches.pagination.total > 0 },
      publicResult: { locale, family: products.map(product => ({ product, offers: product.offers })) },
    });
    return res.json({ success: true, query, products, pagination: matches.pagination });
  } catch (error) {
    console.error("Помилка текстового пошуку:", error);
    return res.status(500).json({ success: false, error: "Не вдалося виконати пошук" });
  }
}


export async function searchSuggestions(req, res) {
  try {
    const suggestions = await PublicSearchSuggestionRepository.list({
      query: req.query.q,
      locale: req.query.locale,
      limit: req.query.limit,
    });

    return res.json({ success: true, suggestions });
  } catch (error) {
    console.error("Помилка підказок пошуку:", error);
    return res.status(500).json({
      success: false,
      error: "Не вдалося завантажити підказки пошуку",
    });
  }
}


async function respondToArticle(
  req,
  res,
  { recordAnalytics = true } = {}
) {
  try {
    res.set("Cache-Control", "private, no-store");
    const article =
      req.query.article;

    const requestedLocale =
      req.query.locale;

    if (typeof article !== "string" || !article.trim() || /^(null|undefined)$/i.test(article.trim()) || article.length > 255) {
      return res
        .status(400)
        .json({
          success: false,

          error:
            "Параметр article є обов’язковим",
        });
    }

    const availabilityContext=await PublicAvailabilityContextService.fromRequest(req);
    const result=await readWebsiteArticleSearch({
      article,requestedLocale,userId:req.auth?.userId??null,
      includeSourceDetails:["ADMIN","MANAGER"].includes(req.auth?.role),
      availabilityContext,
    });
    const {searchResult,publicResult,productCard,familyCards,response}=result;
    if(recordAnalytics){
      await SearchAnalyticsService.recordSearch({
        req,article,searchResult,requestedLocale,
        ...(result.found?{publicResult,analyticsResult:{
          productCard,family:familyCards,
        }}:{})
      });
    }
    return res.status(result.found?200:404).json(response);

  } catch (error) {
    console.error(
      "Ошибка поиска:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,

        error:
          "Внутрішня помилка сервера",
      });
  }
}

// Product rendering and price refreshes must never create search events.
export function productDetails(req, res) {
  return respondToArticle(req, res, { recordAnalytics: false });
}

export function searchByArticle(req, res) {
  return respondToArticle(req, res);
}
