import {
  SearchService,
} from "../services/SearchService.js";

import {
  ProductCardService,
} from "../services/ProductCardService.js";

import {
  PublicSearchPresenterService,
} from "../services/PublicSearchPresenterService.js";

import {
  MercedesFamilyOfferService,
} from "../services/MercedesFamilyOfferService.js";

import {
  SearchAnalyticsService,
} from "../services/SearchAnalyticsService.js";
import { ArticleNumberRepository } from "../repositories/ArticleNumberRepository.js";
import { CustomerPricingService } from "../services/CustomerPricingService.js";
import { PublicSearchSuggestionRepository } from "../repositories/PublicSearchSuggestionRepository.js";
import { cleanPublicSearchQuery } from "../services/PublicSearchQuery.js";
import { OfferService } from "../services/OfferService.js";

export async function searchByText(req, res) {
  const query = cleanPublicSearchQuery(req.query.q);
  if (!query) return res.status(400).json({ success: false, error: "Введіть запит від 2 до 255 символів" });
  const locale = ["uk", "en", "ru"].includes(req.query.locale) ? req.query.locale : "uk";
  try {
    res.set("Cache-Control", "private, no-store");
    const [matches, pricingContext] = await Promise.all([
      PublicSearchSuggestionRepository.search({ query, locale, page: req.query.page }),
      CustomerPricingService.getContext(req.auth?.userId ?? null),
    ]);
    const products = await Promise.all(matches.products.map(async product => {
      const offers = await OfferService.getOffersByProductId(product.id, pricingContext, locale);
      return { ...product, offers: offers.map(offer => ({
        id: offer.id, retailPrice: offer.retailPrice, isAvailable: offer.isAvailable,
        availabilityText: offer.availabilityText, sourceLabel: offer.sourceLabel,
      })) };
    }));
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

    const searchResult =
      await SearchService
        .searchByArticle(
          article
        );

    const pricingContext = await CustomerPricingService.getContext(req.auth?.userId ?? null);
    const includeSourceDetails = [
      "ADMIN",
      "MANAGER",
    ].includes(req.auth?.role);

    if (!searchResult.found) {
      if (recordAnalytics) await SearchAnalyticsService
        .recordSearch({
          req,
          article,
          searchResult,
          requestedLocale,
        });

      return res
        .status(404)
        .json({
          success: false,

          query:
            article,

          normalized:
            searchResult.normalized,

          message:
            "Товар не знайдено",
        });
    }

    const productCard =
      searchResult.exactProduct
        ? await ProductCardService
            .build(
              searchResult.exactProduct,
              pricingContext
            )
        : null;

    const replacementLinks =
      (searchResult.replacementPath || [])
        .filter((link) => link.linkType === "REPLACEMENT");
    const replacementLink = replacementLinks[0] || null;
    const finalReplacementLink = replacementLinks.at(-1) || null;

    const replacementSourceProduct = replacementLink
      ? await ArticleNumberRepository.findSearchProductByBrandAndArticle({
          brandId: replacementLink.sourceBrandId,
          articleNormalized: replacementLink.sourceArticleNormalized,
        })
      : null;

    const replacementSourceCard =
      replacementSourceProduct &&
      Number(replacementSourceProduct.id) !== Number(searchResult.exactProduct?.id)
        ? await ProductCardService.build(replacementSourceProduct, pricingContext)
        : null;

    const familyCards =
      searchResult.family.length > 1
        ? await MercedesFamilyOfferService
            .build({
              family:
                searchResult.family,

              exactProductId:
                searchResult
                  .exactProduct
                  ?.id ?? null,

              requireEnabledSupplierRule:
                searchResult.rule === "MERCEDES" &&
                searchResult.numberResolution !== "PREFIX",
              pricingContext,
            })
        : [];

    const publicResult =
      await PublicSearchPresenterService
        .present({
          requestedLocale,

          family:
            familyCards,

          productCard,
          replacementSourceCard,
          includeSourceDetails,
        });

    if (recordAnalytics) await SearchAnalyticsService
      .recordSearch({
        req,
        article,
        searchResult,
        publicResult,
        analyticsResult: {
          productCard,
          family: familyCards,
        },
        requestedLocale,
      });

    return res.json({
      success: true,

      locale:
        publicResult.locale,

      query:
        searchResult.query,

      normalized:
        searchResult.normalized,

      searchedArticle:
        searchResult
          .searchedArticle ??
        searchResult.normalized,

      rule:
        searchResult.rule,

      parsed:
        searchResult.parsed ??
        null,

      family:
        publicResult.family,

      productCard:
        publicResult.productCard,

      replacement: replacementLink
        ? {
            sourceBrand: replacementLink.sourceBrandName,
            sourceArticle: replacementLink.sourceArticle,
            targetBrand: finalReplacementLink.targetBrandName,
            targetArticle: finalReplacementLink.targetArticle,
            sourceProductCard: publicResult.replacementSourceCard,
          }
        : null,
    });

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
