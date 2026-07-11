import { normalizeArticle } from "./articleEngine/normalize.js";
import { detectArticleRule } from "./articleEngine/detectRule.js";
import { parseMercedesArticle } from "./articleEngine/rules/mercedesRule.js";

import { ProductRepository } from "../repositories/ProductRepository.js";

function buildMercedesCandidates(normalizedArticle) {
  if (/^[ABN]/.test(normalizedArticle)) {
    return [normalizedArticle];
  }

  if (/^\d{10}$/.test(normalizedArticle)) {
    return [`A${normalizedArticle}`];
  }

  if (/^\d{8}$/.test(normalizedArticle)) {
    return [`B${normalizedArticle}`];
  }

  if (/^\d{12}$/.test(normalizedArticle)) {
    return [`N${normalizedArticle}`];
  }

  return [normalizedArticle];
}

export const SearchService = {
  async searchByArticle(rawArticle) {
    const normalized = normalizeArticle(rawArticle);

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

    const rule = detectArticleRule(normalized);

    if (rule === "MERCEDES") {
      const candidates = buildMercedesCandidates(normalized);

      for (const candidate of candidates) {
        const exactProduct =
          await ProductRepository.findByNormalizedArticle(candidate);

        const parsed = parseMercedesArticle(candidate);

        if (!parsed) {
          continue;
        }

        const family =
          await ProductRepository.findMercedesFamilyByBase(
            parsed.articleBase
          );

        if (exactProduct || family.length > 0) {
          return {
            query: rawArticle,
            normalized,
            searchedArticle: candidate,
            rule,
            found: true,
            parsed,
            exactProduct,
            family,
          };
        }
      }

      return {
        query: rawArticle,
        normalized,
        rule,
        found: false,
        exactProduct: null,
        family: [],
      };
    }

    const exactProduct =
      await ProductRepository.findByNormalizedArticle(normalized);

    return {
      query: rawArticle,
      normalized,
      rule,
      found: Boolean(exactProduct),
      exactProduct,
      family: exactProduct ? [exactProduct] : [],
    };
  },
};