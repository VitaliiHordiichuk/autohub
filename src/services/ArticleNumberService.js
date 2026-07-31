import {
  normalizeArticle,
} from "./articleEngine/normalize.js";

import {
  parseMercedesArticle,
} from "./articleEngine/rules/mercedesRule.js";

import {
  ArticleNumberRepository,
} from "../repositories/ArticleNumberRepository.js";


const MAX_CHAIN_DEPTH = 30;


function uniqueByKey(items, keyBuilder) {
  const result = [];
  const seen = new Set();

  for (const item of items) {
    const key = keyBuilder(item);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}


export function isMercedesBrandName(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return (
    normalized === "MERCEDES" ||
    normalized.startsWith(
      "MERCEDESBENZ"
    )
  );
}


export function applyAutomaticMercedesN({
  brandName,
  articleNormalized,
}) {
  if (
    isMercedesBrandName(brandName) &&
    /^\d{12,}$/.test(articleNormalized)
  ) {
    return `N${articleNormalized}`;
  }

  return articleNormalized;
}


function productMetadata(articleNormalized) {
  const parsed =
    parseMercedesArticle(
      articleNormalized
    );

  if (parsed) {
    return {
      articleNoPrefix:
        parsed.articleNoPrefix ??
        (
          /^[ABN]/.test(articleNormalized)
            ? articleNormalized.slice(1)
            : null
        ),
      articleBase:
        parsed.articleBase ??
        articleNormalized,
      articleSuffix:
        parsed.articleSuffix ?? "",
      articleSuffixLength:
        Number(
          parsed.articleSuffixLength ?? 0
        ),
      variantType:
        parsed.variantType ?? "BASE",
    };
  }

  const isLongMercedesN =
    /^N\d{12,}$/.test(
      articleNormalized
    );

  return {
    articleNoPrefix:
      isLongMercedesN
        ? articleNormalized.slice(1)
        : null,
    articleBase:
      isLongMercedesN
        ? articleNormalized
        : null,
    articleSuffix:
      isLongMercedesN ? "" : null,
    articleSuffixLength: 0,
    variantType: "BASE",
  };
}


async function resolveExplicitGraph({
  brandId = null,
  articleNormalized,
  db,
}) {
  const startKey = [
    brandId ?? "*",
    articleNormalized,
  ].join(":");

  const queue = [{
    brandId,
    brandName: null,
    article:
      articleNormalized,
    articleNormalized,
    path: [],
    pathNodes:
      new Set([startKey]),
  }];

  const terminals = [];
  let hadExplicit = false;

  while (queue.length > 0) {
    const current = queue.shift();

    if (
      current.path.length >=
      MAX_CHAIN_DEPTH
    ) {
      throw new Error(
        "Цепочка номеров слишком длинная"
      );
    }

    const outgoing =
      await ArticleNumberRepository
        .findOutgoing({
          brandId: current.brandId,
          articleNormalized:
            current.articleNormalized,
          db,
        });

    if (outgoing.length === 0) {
      terminals.push(current);
      continue;
    }

    hadExplicit = true;

    for (const link of outgoing) {
      const targetKey = [
        link.targetBrandId,
        link.targetArticleNormalized,
      ].join(":");

      if (
        current.pathNodes.has(
          targetKey
        )
      ) {
        throw new Error(
          "Обнаружен цикл в связях номеров"
        );
      }

      queue.push({
        brandId:
          link.targetBrandId,
        brandName:
          link.targetBrandName,
        article:
          link.targetArticle,
        articleNormalized:
          link.targetArticleNormalized,
        path: [
          ...current.path,
          link,
        ],
        pathNodes:
          new Set([
            ...current.pathNodes,
            targetKey,
          ]),
      });
    }
  }

  return {
    hadExplicit,
    terminals:
      uniqueByKey(
        terminals,
        (item) => [
          item.brandId ?? "*",
          item.articleNormalized,
        ].join(":")
      ),
  };
}


export const ArticleNumberService = {
  async resolveForImport({
    brandId,
    article,
    db,
  }) {
    const sourceArticle =
      String(article ?? "")
        .normalize("NFKC")
        .trim();

    const sourceArticleNormalized =
      normalizeArticle(sourceArticle);

    if (!sourceArticleNormalized) {
      throw new Error(
        "После нормализации артикул оказался пустым"
      );
    }

    let currentBrandId =
      Number(brandId);
    let currentArticle =
      sourceArticle;
    let currentArticleNormalized =
      sourceArticleNormalized;
    let currentBrand =
      await ArticleNumberRepository
        .findBrandById(
          currentBrandId,
          db
        );

    if (!currentBrand) {
      throw new Error(
        "Бренд не найден"
      );
    }

    const visited = new Set();
    let aliasApplied = false;

    for (
      let depth = 0;
      depth < MAX_CHAIN_DEPTH;
      depth++
    ) {
      const key = [
        currentBrandId,
        currentArticleNormalized,
      ].join(":");

      if (visited.has(key)) {
        throw new Error(
          "Обнаружен цикл в связях номеров"
        );
      }

      visited.add(key);

      const outgoing =
        await ArticleNumberRepository
          .findOutgoing({
            brandId:
              currentBrandId,
            articleNormalized:
              currentArticleNormalized,
            db,
          });

      const replacements =
        outgoing.filter(
          (link) =>
            link.linkType ===
            "REPLACEMENT"
        );

      // Явная замена всегда важнее
      // автоматического добавления N.
      // Складской остаток остаётся на
      // старом номере, чтобы позже его
      // можно было показать клиенту как
      // доступный предыдущий номер.
      if (replacements.length > 0) {
        return {
          sourceBrandId:
            Number(brandId),
          sourceArticleNormalized,
          brandId:
            currentBrandId,
          brandName:
            currentBrand.name,
          article:
            currentArticle,
          articleNormalized:
            currentArticleNormalized,
          resolutionType:
            "REPLACEMENT_SOURCE",
          explicitReplacement: true,
          canPromoteLegacy:
            aliasApplied,
        };
      }

      const aliases =
        uniqueByKey(
          outgoing.filter(
            (link) =>
              link.linkType ===
              "ALIAS"
          ),
          (link) => [
            link.targetBrandId,
            link.targetArticleNormalized,
          ].join(":")
        );

      if (aliases.length === 0) {
        break;
      }

      if (aliases.length > 1) {
        throw new Error(
          "У номера несколько разных основных карточек"
        );
      }

      const alias = aliases[0];
      aliasApplied = true;
      currentBrandId =
        alias.targetBrandId;
      currentBrand = {
        id: alias.targetBrandId,
        name: alias.targetBrandName,
        is_active: true,
      };
      currentArticle =
        alias.targetArticle;
      currentArticleNormalized =
        alias.targetArticleNormalized;
    }

    const automatic =
      applyAutomaticMercedesN({
        brandName:
          currentBrand.name,
        articleNormalized:
          currentArticleNormalized,
      });

    const automaticApplied =
      automatic !==
      currentArticleNormalized;

    return {
      sourceBrandId:
        Number(brandId),
      sourceArticleNormalized,
      brandId:
        currentBrandId,
      brandName:
        currentBrand.name,
      article:
        automaticApplied
          ? automatic
          : currentArticle,
      articleNormalized:
        automatic,
      resolutionType:
        aliasApplied
          ? "ALIAS"
          : automaticApplied
            ? "MERCEDES_AUTO_N"
            : "DIRECT",
      explicitReplacement: false,
      canPromoteLegacy:
        aliasApplied ||
        automaticApplied,
    };
  },


  async findOrPromoteProduct({
    resolution,
    db,
  }) {
    const canonical =
      await ArticleNumberRepository
        .findProductByBrandAndArticle({
          brandId:
            resolution.brandId,
          articleNormalized:
            resolution.articleNormalized,
          db,
        });

    if (canonical) {
      return canonical;
    }

    if (
      !resolution.canPromoteLegacy ||
      resolution.sourceBrandId !==
        resolution.brandId ||
      resolution.sourceArticleNormalized ===
        resolution.articleNormalized
    ) {
      return null;
    }

    const legacy =
      await ArticleNumberRepository
        .findProductByBrandAndArticle({
          brandId:
            resolution.sourceBrandId,
          articleNormalized:
            resolution.sourceArticleNormalized,
          db,
        });

    if (!legacy) {
      return null;
    }

    const metadata =
      productMetadata(
        resolution.articleNormalized
      );

    return ArticleNumberRepository
      .promoteProductArticle({
        productId:
          Number(legacy.id),
        brandId:
          resolution.brandId,
        article:
          resolution.article,
        articleNormalized:
          resolution.articleNormalized,
        ...metadata,
        db,
      });
  },


  async buildExplicitSearchCandidates({
    articleNormalized,
    db,
  }) {
    const normalized =
      normalizeArticle(
        articleNormalized
      );

    if (!normalized) {
      return [];
    }

    const explicit =
      await resolveExplicitGraph({
        articleNormalized:
          normalized,
        db,
      });

    if (!explicit.hadExplicit) {
      return [];
    }

    const terminals =
      explicit.terminals
        .sort(
          (a, b) =>
            b.path.length -
            a.path.length
        )
        .map((item) => ({
          brandId: item.brandId,
          articleNormalized:
            item.articleNormalized,
          displayArticle:
            item.article,
          resolutionType:
            item.path.some(
              (link) =>
                link.linkType ===
                "REPLACEMENT"
            )
              ? "REPLACEMENT"
              : "ALIAS",
          path: item.path,
        }));

    return uniqueByKey(
      terminals,
      (item) => [
        item.brandId ?? "*",
        item.articleNormalized,
      ].join(":")
    );
  },
};
