export function detectArticleRule(normalizedArticle) {
  if (!normalizedArticle) {
    return "DEFAULT";
  }

  // Mercedes с явным префиксом.
  if (/^[ABN]/.test(normalizedArticle)) {
    return "MERCEDES";
  }

  // Mercedes без первой буквы:
  // A + 10 цифр, B + 8 цифр, N + 12 цифр.
  if (/^\d{8}$|^\d{10}$|^\d{12}$/.test(normalizedArticle)) {
    return "MERCEDES";
  }

  return "DEFAULT";
}