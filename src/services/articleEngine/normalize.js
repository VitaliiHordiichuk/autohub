const CYRILLIC_MAP = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
};

export function normalizeArticle(article) {
  if (article === null || article === undefined) {
    return "";
  }

  const original = String(article);

  let normalized = original.trim().toUpperCase();

  normalized = normalized
    .split("")
    .map((char) => CYRILLIC_MAP[char] ?? char)
    .join("");

  // Удаляем разделители и прочие символы.
  // Оставляем только латинские буквы и цифры.
  normalized = normalized.replace(/[^A-Z0-9]/g, "");

  return normalized;
}