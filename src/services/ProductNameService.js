const TECHNICAL_TOKENS = new Set([
  "ABS", "ABC", "AC", "АКПП", "AMG", "CAN", "CDI", "ДВС", "DPF",
  "ESP", "ГРМ", "ГУР", "LED", "LHD", "КПП", "RHD", "SRS", "VIN",
  "ШРУС",
]);

function upperFirstLetter(value) {
  return value.replace(/[\p{L}]/u, (letter) => letter.toLocaleUpperCase());
}

function restoreTechnicalToken(token, originalToken) {
  const plainToken = originalToken.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const normalized = plainToken.toLocaleUpperCase();

  if (TECHNICAL_TOKENS.has(normalized)) {
    return token.replace(plainToken.toLocaleLowerCase(), normalized);
  }

  if (/^(?=.*\d)[\p{L}\p{N}-]{2,12}$/u.test(plainToken)) {
    return token.replace(plainToken.toLocaleLowerCase(), plainToken);
  }

  return token;
}

function normalizeAllCaps(value) {
  const letters = value.match(/\p{L}/gu) || [];
  if (letters.length < 4 || !letters.every((letter) => letter === letter.toLocaleUpperCase())) {
    return value;
  }

  const originalTokens = value.split(" ");
  const loweredTokens = value.toLocaleLowerCase().split(" ");
  const restored = loweredTokens.map((token, index) =>
    restoreTechnicalToken(token, originalTokens[index] || token));

  return upperFirstLetter(restored.join(" "));
}

export function normalizeProductName(value) {
  const compact = String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s./\\|,:;·•–—-]+/u, "")
    .replace(/\s*\/{2,}\s*/g, " / ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeAllCaps(compact);
}

export function publicProductName(value, provider = null) {
  const name = String(value || "").trim();
  if (!name) return "";
  return provider === "MANUAL" ? name : normalizeProductName(name);
}

export const ProductNameService = {
  normalizeImported: normalizeProductName,
  publicName: publicProductName,
};
