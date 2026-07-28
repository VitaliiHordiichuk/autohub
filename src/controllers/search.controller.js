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


export async function searchByArticle(
  req,
  res
) {
  try {
    const article =
      req.query.article;

    const requestedLocale =
      req.query.locale;

    if (!article) {
      return res
        .status(400)
        .json({
          success: false,

          error:
            "Параметр article обязателен",
        });
    }

    const searchResult =
      await SearchService
        .searchByArticle(
          article
        );

    if (!searchResult.found) {
      await SearchAnalyticsService
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
            "Товар не найден",
        });
    }

    const productCard =
      searchResult.exactProduct
        ? await ProductCardService
            .build(
              searchResult
                .exactProduct
            )
        : null;

    const familyCards =
      searchResult.rule === "MERCEDES"
        ? await MercedesFamilyOfferService
            .build({
              family:
                searchResult.family,

              exactProductId:
                searchResult
                  .exactProduct
                  ?.id ?? null,
            })
        : [];

    const publicResult =
      await PublicSearchPresenterService
        .present({
          requestedLocale,

          family:
            familyCards,

          productCard,
        });

    await SearchAnalyticsService
      .recordSearch({
        req,
        article,
        searchResult,
        publicResult,
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
          "Внутренняя ошибка сервера",
      });
  }
}
