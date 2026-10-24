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

function currency(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(amount) + " грн"
    : null;
}

function articleUrl(article, locale) {
  const normalized = normalizeArticle(article);
  if (!ARTICLE_RE.test(normalized)) return null;
  const lang = ["uk", "ru", "en"].includes(locale) ? locale : "uk";
  return "https://maka.com.ua/" + lang + "/product/" + encodeURIComponent(article);
}

function available(offers) {
  return (offers || []).filter((offer) =>
    offer?.isAvailable === true && Number(offer.quantity) > 0 && currency(offer.retailPrice));
}

function stockLines(offers, locale, compact) {
  const live = available(offers);
  const own = live.filter((offer) => offer.sourceType === "OWN_STOCK");
  const partner = live.filter((offer) => offer.sourceType === "SUPPLIER");
  const groups = [
    ["🏬", "Склад MAKA", own],
    ["🚚", "Поставщики (под заказ)", partner],
  ];
  const lines = [];
  for (const [emoji, name, group] of groups) {
    if (!group.length) continue;
    const entries = [...group].sort((a, b) => a.retailPrice - b.retailPrice);
    if (compact) {
      lines.push(emoji + " " + name + ": от " + currency(entries[0].retailPrice)
        + " (" + entries.length + " предл.)");
    } else {
      lines.push(emoji + " <b>" + name + "</b>");
      for (const offer of entries.slice(0, 3)) {
        const qty = offer.displayQuantity || String(offer.quantity);
        const city = offer.sourceType === "OWN_STOCK" && offer.warehouseCity
          ? " · " + escapeTelegramHtml(offer.warehouseCity) : "";
        lines.push("• " + currency(offer.retailPrice) + " · " + escapeTelegramHtml(qty)
          + " шт." + city + (offer.sourceType === "SUPPLIER" && offer.availabilityText
            ? " · " + escapeTelegramHtml(offer.availabilityText) : ""));
      }
      if (entries.length > 3) lines.push("… и ещё " + (entries.length - 3) + " предл.");
    }
  }
  if (!lines.length) lines.push("Нет доступных предложений.");
  return lines;
}

function relatedLines(items, title) {
  const visible = (items || []).filter((item) => available(item.offers).length > 0).slice(0, 3);
  if (!visible.length) return [];
  return [
    "<b>" + title + ":</b>",
    ...visible.map(({ product, offers }) => {
      const price = Math.min(...available(offers).map((offer) => Number(offer.retailPrice)));
      return "• " + escapeTelegramHtml(product.article || "") + " — " + currency(price);
    }),
  ];
}

export function formatTelegramProduct({ query, card, locale = "uk", replacementArticle = null, compact = false }) {
  if (!card?.product) {
    return { text: "❌ <code>" + escapeTelegramHtml(query) + "</code> — не найдено" };
  }
  const product = card.product;
  const article = String(product.article || query);
  const url = articleUrl(article, locale);
  const name = String(product.name || "Запчасть").slice(0, 180);
  const heading = escapeTelegramHtml(article);
  const articleLabel = compact && url
    ? '<a href="' + escapeTelegramHtml(url) + '">' + heading + "</a>"
    : "<b>" + heading + "</b>";
  const header = "🔎 " + articleLabel + " — " + escapeTelegramHtml(name);
  const lines = [header, ...stockLines(card.offers, locale, compact)];
  if (!compact) {
    if (replacementArticle && normalizeArticle(replacementArticle) !== normalizeArticle(article)) {
      lines.push("🔄 Замена номера: <code>" + escapeTelegramHtml(replacementArticle) + "</code>");
    }
    lines.push(...relatedLines(card.replacements, "Замены"));
    lines.push(...relatedLines(card.analogs, "Аналоги"));
  }
  const text = lines.join("\n").slice(0, MAX_HTML_LENGTH);
  return {
    text,
    ...(url && !compact ? { reply_markup: {
      inline_keyboard: [[{ text: "Посмотреть на MAKA", url }]],
    } } : {}),
    ...(url && compact ? { url } : {}),
  };
}

export function formatTelegramNotFound(article) {
  return { text: "❌ <code>" + escapeTelegramHtml(article) + "</code> — не найдено" };
}

export function formatTelegramHelp() {
  return { text: "🤖 <b>Привіт! Я MAKAtron — робот-помічник MAKA.com.ua.</b>\n"
    + "Надішліть артикул або список до 20 артикулів — по одному в рядку (або через кому чи ;).\n"
    + "Перевірю склад MAKA, пропозиції постачальників, заміни й аналоги.\n"
    + "Персональна ціна доступна після прив’язки Telegram у профілі MAKA." };
}

export function formatTelegramInputError(error) {
  const message = error === "TOO_MANY" ? "Максимум 20 артикулов в одном сообщении."
    : error === "INPUT_LENGTH" ? "Слишком длинное или пустое сообщение."
    : "Отправьте артикул (буквы и цифры) или список артикулов, по одному в строке.";
  return { text: "⚠️ " + message };
}

export function formatTelegramBatch(results) {
  // 5 entries per Telegram message keeps each part below Telegram's 4096-char limit.
  const chunks = [];
  for (let i = 0; i < results.length; i += 5) {
    chunks.push({
      text: "<b>MAKAtron · Результати " + (i + 1) + "–" + Math.min(i + 5, results.length)
        + " из " + results.length + "</b>\n\n"
        + results.slice(i, i + 5).map((r) => r.text).join("\n\n"),
      parse_mode: "HTML",
    });
  }
  return chunks;
}
