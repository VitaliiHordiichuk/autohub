import {
  normalizeArticle,
} from "./articleEngine/normalize.js";

import {
  detectArticleRule,
} from "./articleEngine/detectRule.js";

import {
  parseMercedesArticle,
} from "./articleEngine/rules/mercedesRule.js";

import {
  ArticleNumberService,
  isMercedesBrandName,
} from "./ArticleNumberService.js";

import {
  ArticleNumberRepository,
} from "../repositories/ArticleNumberRepository.js";

import {
  ProductRepository,
} from "../repositories/ProductRepository.js";


function isMercedesProduct(product) {
  return isMercedesBrandName(
    product?.brand_name ??
    product?.manufacturer ??
    product?.vehicle_brand
  );
}


function buildLegacyMercedesCandidates(
  normalizedArticle
) {
  if (/^[ABN]/.test(normalizedArticle)) {
    return [normalizedArticle];
  }

  if (/^\d{10}$/.test(normalizedArticle)) {
    return [`A${normalizedArticle}`];
  }

  if (/^\d{8}$/.test(normalizedArticle)) {
    return [`B${normalizedArticle}`];
  }

  return [];
}

function buildPrefixCandidates(normalized) {
  if (normalized.length < 6) return [];

  const candidates = [normalized];

  if (/^\d+$/.test(normalized)) {
    candidates.push(`A${normalized}`);
    if (normalized.length >= 12) candidates.push(`N${normalized}`);
  }

  if (/^N\d+$/.test(normalized)) {
    candidates.push(normalized.slice(1));
  }

  return [...new Set(candidates)];
}


async function findProduct(candidate) {
  if (candidate.brandId) {
    return ArticleNumberRepository
      .findSearchProductByBrandAndArticle({
        brandId:
          candidate.brandId,
        articleNormalized:
          candidate.articleNormalized,
      });
  }

  const products =
    await ArticleNumberRepository
      .findSearchProductsByArticle({
        articleNormalized:
          candidate.articleNormalized,
      });

  if (candidate.mercedesOnly) {
    return products.find(
      isMercedesProduct
    ) ?? null;
  }

  return products[0] ?? null;
}


function withDisplayArticle(
  product,
  _displayArticle
) {
  // Показываем ровно тот артикул, который
  // хранится в прайсе. A/N используются
  // только для разрешения поискового запроса.
  return product;
}


async function buildResult({
  rawArticle,
  normalized,
  candidate,
  exactProduct,
}) {
  const displayArticle =
    candidate.displayArticle ||
    candidate.articleNormalized;

  const displayedProduct =
    withDisplayArticle(
      exactProduct,
      displayArticle
    );

  const rule =
    detectArticleRule(
      displayArticle
    );

  if (rule !== "MERCEDES") {
    if (!displayedProduct) {
      return null;
    }

    return {
      query: rawArticle,
      normalized,
      searchedArticle:
        displayArticle,
      rule: "DEFAULT",
      found: true,
      parsed: null,
      exactProduct:
        displayedProduct,
      family: [
        displayedProduct,
      ],
      numberResolution:
        candidate.resolutionType,
      replacementPath:
        candidate.path || [],
    };
  }

  const parsed =
    parseMercedesArticle(
      displayArticle
    );

  let family = [];

  if (parsed?.articleBase) {
    family =
      await ProductRepository
        .findMercedesFamilyByBase(
          parsed.articleBase
        );
  }

  if (
    family.length === 0 &&
    displayedProduct
  ) {
    family = [displayedProduct];
  }

  const prefixProducts =
    await ArticleNumberRepository
      .findSearchProductsByPrefixes({
        articlePrefixes: [
          ...buildPrefixCandidates(normalized),
          ...buildPrefixCandidates(displayArticle),
        ],
      });

  family = [
    ...new Map(
      [...family, ...prefixProducts]
        .map((product) => [
          Number(product.id),
          product,
        ])
    ).values(),
  ];

  if (
    !displayedProduct &&
    family.length === 0
  ) {
    return null;
  }

  return {
    query: rawArticle,
    normalized,
    searchedArticle:
      displayArticle,
    rule: "MERCEDES",
    found: true,
    parsed: parsed ?? null,
    exactProduct:
      displayedProduct,
    family,
    numberResolution:
      candidate.resolutionType,
    replacementPath:
      candidate.path || [],
  };
}


async function tryCandidate({
  rawArticle,
  normalized,
  candidate,
}) {
  const exactProduct =
    await findProduct(candidate);

  if (!exactProduct) {
    return null;
  }

  return buildResult({
    rawArticle,
    normalized,
    candidate,
    exactProduct,
  });
}


export const SearchService = {
  async searchByArticle(rawArticle) {
    const normalized =
      normalizeArticle(rawArticle);

    if (!normalized) {
      return {
        query: rawArticle ?? "",
        normalized: "",
        rule: "DEFAULT",
        found: false,
        exactProduct: null,
        family: [],
      };
    }

    // Явные ALIAS/REPLACEMENT всегда
    // проверяются раньше любых правил.
    const explicitCandidates =
      await ArticleNumberService
        .buildExplicitSearchCandidates({
          articleNormalized:
            normalized,
        });

    for (
      const candidate of
        explicitCandidates
    ) {
      const result =
        await tryCandidate({
          rawArticle,
          normalized,
          candidate,
        });

      if (result) {
        return result;
      }
    }

    const directProducts =
      await ArticleNumberRepository
        .findSearchProductsByArticle({
          articleNormalized:
            normalized,
        });

    // Даже когда конечная замена ещё не
    // заведена как товар, сама явная связь
    // блокирует автоматическое добавление N.
    if (explicitCandidates.length > 0) {
      if (directProducts[0]) {
        return buildResult({
          rawArticle,
          normalized,
          candidate: {
            brandId:
              Number(
                directProducts[0]
                  .brand_id
              ) || null,
            articleNormalized:
              normalized,
            displayArticle:
              normalized,
            resolutionType:
              "EXPLICIT_SOURCE",
            path: [],
          },
          exactProduct:
            directProducts[0],
        });
      }

      return {
        query: rawArticle,
        normalized,
        rule:
          detectArticleRule(
            normalized
          ),
        found: false,
        exactProduct: null,
        family: [],
      };
    }

    // Цифровое точное совпадение меняем
    // на N только когда карточка относится
    // именно к Mercedes-Benz.
    if (/^\d{12,}$/.test(normalized)) {
      const mercedesDirect =
        directProducts.find(
          isMercedesProduct
        );

      if (mercedesDirect) {
        const canonical =
          `N${normalized}`;

        const canonicalProduct =
          await ArticleNumberRepository
            .findSearchProductByBrandAndArticle({
              brandId:
                Number(
                  mercedesDirect.brand_id
                ),
              articleNormalized:
                canonical,
            });

        return buildResult({
          rawArticle,
          normalized,
          candidate: {
            brandId:
              Number(
                mercedesDirect.brand_id
              ),
            articleNormalized:
              canonicalProduct
                ? canonical
                : normalized,
            displayArticle:
              canonical,
            resolutionType:
              canonicalProduct
                ? "MERCEDES_CANONICAL_N"
                : "MERCEDES_LEGACY",
            path: [],
          },
          exactProduct:
            canonicalProduct ??
            mercedesDirect,
        });
      }

      if (directProducts[0]) {
        return buildResult({
          rawArticle,
          normalized,
          candidate: {
            brandId:
              Number(
                directProducts[0]
                  .brand_id
              ) || null,
            articleNormalized:
              normalized,
            displayArticle:
              normalized,
            resolutionType:
              "DIRECT",
            path: [],
          },
          exactProduct:
            directProducts[0],
        });
      }

      const canonical =
        `N${normalized}`;

      const result =
        await tryCandidate({
          rawArticle,
          normalized,
          candidate: {
            brandId: null,
            articleNormalized:
              canonical,
            displayArticle:
              canonical,
            resolutionType:
              "MERCEDES_AUTO_N",
            mercedesOnly: true,
            path: [],
          },
        });

      if (result) {
        return result;
      }
    }

    if (/^N\d{12,}$/.test(normalized)) {
      if (directProducts[0]) {
        return buildResult({
          rawArticle,
          normalized,
          candidate: {
            brandId:
              Number(
                directProducts[0]
                  .brand_id
              ) || null,
            articleNormalized:
              normalized,
            displayArticle:
              normalized,
            resolutionType:
              "DIRECT",
            path: [],
          },
          exactProduct:
            directProducts[0],
        });
      }

      const legacy =
        await tryCandidate({
          rawArticle,
          normalized,
          candidate: {
            brandId: null,
            articleNormalized:
              normalized.slice(1),
            displayArticle:
              normalized,
            resolutionType:
              "MERCEDES_LEGACY",
            mercedesOnly: true,
            path: [],
          },
        });

      if (legacy) {
        return legacy;
      }
    }

    if (directProducts[0]) {
      return buildResult({
        rawArticle,
        normalized,
        candidate: {
          brandId:
            Number(
              directProducts[0]
                .brand_id
            ) || null,
          articleNormalized:
            normalized,
          displayArticle:
            normalized,
          resolutionType:
            "DIRECT",
          path: [],
        },
        exactProduct:
          directProducts[0],
      });
    }

    const detectedRule =
      detectArticleRule(normalized);

    if (detectedRule === "MERCEDES") {
      const candidates =
        buildLegacyMercedesCandidates(
          normalized
        );

      for (const article of candidates) {
        const result =
          await tryCandidate({
            rawArticle,
            normalized,
            candidate: {
              brandId: null,
              articleNormalized:
                article,
              displayArticle:
                article,
              resolutionType:
                "MERCEDES_LEGACY_RULE",
              mercedesOnly: true,
              path: [],
            },
          });

        if (result) {
          return result;
        }
      }
    }

    const prefixProducts =
      await ArticleNumberRepository
        .findSearchProductsByPrefixes({
          articlePrefixes: buildPrefixCandidates(normalized),
        });

    if (prefixProducts.length > 0) {
      const exactProduct = prefixProducts[0];
      const mercedesResult = prefixProducts.some(isMercedesProduct);

      return {
        query: rawArticle,
        normalized,
        searchedArticle: exactProduct.article_normalized,
        rule: mercedesResult ? "MERCEDES" : "PREFIX",
        found: true,
        parsed: mercedesResult
          ? parseMercedesArticle(exactProduct.article_normalized)
          : null,
        exactProduct,
        family: prefixProducts,
        numberResolution: "PREFIX",
        replacementPath: [],
      };
    }

    return {
      query: rawArticle,
      normalized,
      rule: detectedRule,
      found: false,
      exactProduct: null,
      family: [],
    };
  },
};
