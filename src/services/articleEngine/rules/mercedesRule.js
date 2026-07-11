const MERCEDES_BASE_LENGTHS = {
  A: 11, // A + 10 цифр
  B: 9,  // B + 8 цифр
  N: 13, // N + 12 цифр
};

export function parseMercedesArticle(normalizedArticle) {
  if (!normalizedArticle) {
    return null;
  }

  const prefix = normalizedArticle[0];
  const baseLength = MERCEDES_BASE_LENGTHS[prefix];

  if (!baseLength) {
    return null;
  }

  if (normalizedArticle.length < baseLength) {
    return null;
  }

  const articleBase = normalizedArticle.slice(0, baseLength);
  const articleSuffix = normalizedArticle.slice(baseLength);
  const suffixLength = articleSuffix.length;

  let variantType = "BASE";

  if (suffixLength === 2) {
    variantType = "SAME";
  } else if (suffixLength >= 4) {
    variantType = "VARIANT";
  } else if (suffixLength > 0) {
    variantType = "UNKNOWN";
  }

  return {
    rule: "MERCEDES",
    normalized: normalizedArticle,
    prefix,
    articleBase,
    articleSuffix,
    suffixLength,
    variantType,
  };
}