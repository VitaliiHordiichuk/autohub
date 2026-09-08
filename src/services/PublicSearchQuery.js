const synonymGroups = [
  ["колодки", "колодка", "колодок", "pads", "pad"],
  ["гальмівні", "гальмівний", "гальмівна", "гальмівного", "тормозные", "тормозной", "тормозная", "тормозных", "brake", "brakes"],
  ["фільтр", "фільтри", "фильтр", "фильтры", "filter", "filters"],
  ["амортизатор", "амортизатори", "амортизаторы", "absorber", "absorbers"],
  ["килимок", "килимки", "коврик", "коврики", "mat", "mats"],
];

export function cleanPublicSearchQuery(value) {
  if (typeof value !== "string") return "";
  const query = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return query.length >= 2 && query.length <= 255 && !/^(null|undefined)$/i.test(query) ? query : "";
}

export function escapeSearchLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function isArticleQuery(value) {
  const query = value.trim();
  return /\d/.test(query) && /^[a-zавсекмнортхуі\d\s./_+-]+$/i.test(query)
    && query.split(/\s+/).every(word => /[a-zавсекмнортхуі\d]/i.test(word)
      && !/^[a-zа-яіїєґ]{4,}$/i.test(word));
}

export function publicSearchTerms(query) {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  // Bound work on the public endpoint; do not silently discard extra words.
  if (terms.length > 12) return [];
  return terms.map(term => (synonymGroups.find(group => group.includes(term)) || [term])
    .map(value => `%${escapeSearchLike(value)}%`));
}
