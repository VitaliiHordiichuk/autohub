import { normalizeArticle } from "./articleEngine/normalize.js";

export const TELEGRAM_CATALOG_MAX_ARTICLES = 20;
const MAX_INPUT_LENGTH = 2500;
const ARTICLE_RE = /^[A-Z0-9]{4,40}$/;
const MAX_HTML_LENGTH = 3500;

export function parseTelegramArticles(input) {
  const text = String(input ?? "").trim();
  if (!text || text.length > MAX_INPUT_LENGTH) {
    return { error: "INPUT_LENGTH", articles: [] };
  }
  // Lists use newlines, commas or semicolons. Spaces inside an article are valid.
  const parts = text.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
  if (parts.length > TELEGRAM_CATALOG_MAX_ARTICLES) {
    return { error: "TOO_MANY", articles: [] };
  }
  const articles = [];
  const seen = new Set();
  for (const part of parts) {
    const normalized = normalizeArticle(part);
    if (/[<>{}]/.test(part) || !ARTICLE_RE.test(normalized) || !/\d/.test(normalized) || part.length > 255) {
      return { error: "INVALID_ARTICLE", articles: [] };
    }
    if (!seen.has(normalized)) {
      articles.push(part);
      seen.add(normalized);
    }
  }
  return { error: null, articles };
}

export function escapeTelegramHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}


function lang(locale) {
  return locale === "en" ? "en" : "uk";
}

const COPY = {
  uk: {
    own: "Склад MAKA", partner: "Постачальники (під замовлення)",
    from: "від", offers: "проп.", pcs: "шт.", more: "… і ще",
    noOffers: "Немає доступних пропозицій.", notFound: "не знайдено",
    part: "Запчастина", replacementNumber: "Заміна номера",
    replacements: "Заміни", analogs: "Аналоги", open: "Переглянути на MAKA",
    tooMany: "Максимум 20 артикулів в одному повідомленні.",
    invalidLength: "Занадто довге або порожнє повідомлення.",
    invalidArticle: "Надішліть артикул (літери й цифри) або список артикулів, по одному в рядку.",
    results: "Результати", of: "з",
  },
  en: {
    own: "MAKA warehouse", partner: "Suppliers (on order)",
    from: "from", offers: "offers", pcs: "pcs", more: "… and",
    noOffers: "No available offers.", notFound: "not found",
    part: "Part", replacementNumber: "Superseded by",
    replacements: "Replacements", analogs: "Alternatives", open: "View on MAKA",
    tooMany: "You can search for up to 20 part numbers per message.",
    invalidLength: "This message is empty or too long.",
    invalidArticle: "Send a part number (letters and digits), or a list of part numbers, one per line.",
    results: "Results", of: "of",
  },
};

function currency(value, locale = "uk") {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? new Intl.NumberFormat(lang(locale) === "en" ? "en-GB" : "uk-UA", { maximumFractionDigits: 2 }).format(amount)
      + (lang(locale) === "en" ? " UAH" : " грн")
    : null;
}

function articleUrl(article, locale) {
  const normalized = normalizeArticle(article);
  if (!ARTICLE_RE.test(normalized)) return null;
  return "https://maka.com.ua/" + lang(locale) + "/product/" + encodeURIComponent(article);
}

function available(offers) {
  return (offers || []).filter((offer) =>
    offer?.isAvailable === true && Number(offer.quantity) > 0 && currency(offer.retailPrice));
}

function stockLines(offers, locale, compact) {
  const t = COPY[lang(locale)];
  const live = available(offers);
  const own = live.filter((offer) => offer.sourceType === "OWN_STOCK");
  const partner = live.filter((offer) => offer.sourceType === "SUPPLIER");
  const groups = [
    ["🏬", t.own, own],
    ["🚚", t.partner, partner],
  ];
  const lines = [];
  for (const [emoji, name, group] of groups) {
    if (!group.length) continue;
    const entries = [...group].sort((a, b) => a.retailPrice - b.retailPrice);
    if (compact) {
      lines.push(emoji + " " + name + ": " + t.from + " " + currency(entries[0].retailPrice, locale)
        + " (" + entries.length + " " + t.offers + ")");
    } else {
      lines.push(emoji + " <b>" + name + "</b>");
      for (const offer of entries.slice(0, 3)) {
        const qty = offer.displayQuantity || String(offer.quantity);
        const city = offer.sourceType === "OWN_STOCK" && offer.warehouseCity
          ? " · " + escapeTelegramHtml(offer.warehouseCity) : "";
        lines.push("• " + currency(offer.retailPrice, locale) + " · " + escapeTelegramHtml(qty)
          + " " + t.pcs + city + (offer.sourceType === "SUPPLIER" && offer.availabilityText
            ? " · " + escapeTelegramHtml(offer.availabilityText) : ""));
      }
      if (entries.length > 3) lines.push(t.more + " " + (entries.length - 3) + " " + t.offers);
    }
  }
  if (!lines.length) lines.push(t.noOffers);
  return lines;
}

function relatedLines(items, title, locale) {
  const visible = (items || []).filter((item) => available(item.offers).length > 0).slice(0, 3);
  if (!visible.length) return [];
  return [
    "<b>" + title + ":</b>",
    ...visible.map(({ product, offers }) => {
      const price = Math.min(...available(offers).map((offer) => Number(offer.retailPrice)));
      return "• " + escapeTelegramHtml(product.article || "") + " — " + currency(price, locale);
    }),
  ];
}

export function formatTelegramProduct({ query, card, locale = "uk", replacementArticle = null, compact = false }) {
  const t = COPY[lang(locale)];
  if (!card?.product) {
    return { text: "❌ <code>" + escapeTelegramHtml(query) + "</code> — " + t.notFound };
  }
  const product = card.product;
  const article = String(product.article || query);
  const url = articleUrl(article, locale);
  const name = String(product.name || t.part).slice(0, 180);
  const heading = escapeTelegramHtml(article);
  const articleLabel = compact && url
    ? '<a href="' + escapeTelegramHtml(url) + '">' + heading + "</a>"
    : "<b>" + heading + "</b>";
  const header = "🔎 " + articleLabel + " — " + escapeTelegramHtml(name);
  const lines = [header, ...stockLines(card.offers, locale, compact)];
  if (!compact) {
    if (replacementArticle && normalizeArticle(replacementArticle) !== normalizeArticle(article)) {
      lines.push("🔄 " + t.replacementNumber + ": <code>" + escapeTelegramHtml(replacementArticle) + "</code>");
    }
    lines.push(...relatedLines(card.replacements, t.replacements, locale));
    lines.push(...relatedLines(card.analogs, t.analogs, locale));
  }
  const text = lines.join("\n").slice(0, MAX_HTML_LENGTH);
  return {
    text,
    ...(url && !compact ? { reply_markup: {
      inline_keyboard: [[{ text: t.open, url }]],
    } } : {}),
    ...(url && compact ? { url } : {}),
  };
}

export function formatTelegramNotFound(article, locale = "uk") {
  return { text: "❌ <code>" + escapeTelegramHtml(article) + "</code> — " + COPY[lang(locale)].notFound };
}

export function formatTelegramHelp({ firstName = null, locale = "uk" } = {}) {
  const safeName = String(firstName ?? "").trim().slice(0, 60);
  const english = lang(locale) === "en";
  const greeting = (english ? "Hello" : "Привіт") +
    (safeName ? ", " + escapeTelegramHtml(safeName) : "") + "!";
  return { parse_mode: "HTML", text: english
    ? "🤖 <b>" + greeting + " I'm MAKAtron, your MAKA.com.ua parts assistant.</b>\n"
      + "Send a part number or a list of up to 20 numbers, one per line (or separated by comma or ;).\n"
      + "I'll check MAKA stock, supplier offers, replacements and alternatives.\n"
      + "Your personal price is available after connecting Telegram to your MAKA account.\n"
      + "🌐 Change language: /language"
    : "🤖 <b>" + greeting + " Я MAKAtron — робот-помічник MAKA.com.ua.</b>\n"
      + "Надішліть артикул або список до 20 артикулів — по одному в рядку (або через кому чи ;).\n"
      + "Перевірю склад MAKA, пропозиції постачальників, заміни й аналоги.\n"
      + "Персональна ціна доступна після прив’язки Telegram у профілі MAKA.\n"
      + "🌐 Змінити мову: /language" };
}

export function formatTelegramInputError(error, locale = "uk") {
  const t = COPY[lang(locale)];
  const message = error === "TOO_MANY" ? t.tooMany
    : error === "INPUT_LENGTH" ? t.invalidLength : t.invalidArticle;
  return { text: "⚠️ " + message };
}

export function formatTelegramBatch(results, locale = "uk") {
  const t = COPY[lang(locale)];
  const chunks = [];
  for (let i = 0; i < results.length; i += 5) {
    chunks.push({
      text: "<b>MAKAtron · " + t.results + " " + (i + 1) + "–" + Math.min(i + 5, results.length)
        + " " + t.of + " " + results.length + "</b>\n\n"
        + results.slice(i, i + 5).map((r) => r.text).join("\n\n"),
      parse_mode: "HTML",
    });
  }
  return chunks;
}
