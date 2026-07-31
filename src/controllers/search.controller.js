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

    const pricingContext = await CustomerPricingService.getContext(req.auth?.userId ?? null);

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
          "Внутренняя ошибка сервера",
      });
  }
}
