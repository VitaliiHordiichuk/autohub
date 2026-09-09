const TECHNICAL_TOKENS = new Map([
  "ABS", "ABC", "AC", "АКПП", "AMG", "CAN", "CDI", "ДВС", "DPF",
  "ESP", "ГРМ", "ГУР", "LED", "LHD", "КПП", "OEM", "RHD", "SRS",
  "VIN", "ШРУС",
].map((token) => [token, token]));

TECHNICAL_TOKENS.set("MERCEDES", "Mercedes");
TECHNICAL_TOKENS.set("MERCEDES-BENZ", "Mercedes-Benz");

function upperFirstLetter(value) {
  return value.replace(/[\p{L}]/u, (letter) => letter.toLocaleUpperCase());
}

function restoreTechnicalToken(token, originalToken) {
  const plainToken = originalToken.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const normalized = plainToken.toLocaleUpperCase();

  if (TECHNICAL_TOKENS.has(normalized)) {
    return token.replace(
      plainToken.toLocaleLowerCase(),
      TECHNICAL_TOKENS.get(normalized)
    );
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

function stripDanglingEnding(value) {
  let result = value;

  while (result) {
    const cleaned = result
      .replace(/\s*(?:\/{1,}|\\{1,}|\|{1,}|[,;:#]|[-–—]{1,}|\({1,}|\.{2,})\s*$/u, "")
      .trim();

    if (cleaned === result) return result;
    result = cleaned;
  }

  return result;
}

export function normalizeProductName(value) {
  const compact = stripDanglingEnding(String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s./\\|,:;#·•–—-]+/u, ""))
    .replace(/\s*\/{2,}\s*/g, " / ")
    .replace(/\s+\/\s+/g, " / ")
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
