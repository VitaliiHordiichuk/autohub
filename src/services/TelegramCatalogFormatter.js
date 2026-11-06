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
    ownByCity: "Склад", inStock: "В наявності",
    noOwnStock: "немає в наявності на наших складах.",
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
    ownByCity: "Warehouse", inStock: "In stock",
    noOwnStock: "not available in our warehouses.",
  },
};

function currency(value, locale = "uk") {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? new Intl.NumberFormat(lang(locale) === "en" ? "en-GB" : "uk-UA", { maximumFractionDigits: 2 }).format(amount)
      + (lang(locale) === "en" ? " UAH" : " грн")
    : null;
}

export function telegramProductUrl(article, locale = "uk") {
  const normalized = normalizeArticle(article);
  if (!ARTICLE_RE.test(normalized)) return null;
  return "https://maka.com.ua/" + lang(locale) + "/product/" + encodeURIComponent(article);
}
const articleUrl = telegramProductUrl;


// Warehouse cities are stored in source data, sometimes in different
// languages. Only normalize known equivalents for display/grouping: do not
// assign a city when the site has none or infer locations from product data.
function localizedWarehouseCity(value, locale) {
  const raw = typeof value === "string" ? value.trim().slice(0, 90) : "";
  if (!raw) return "";
  if (/^(?:харків|харьков|kharkiv|kharkov)$/iu.test(raw)) {
    return lang(locale) === "en" ? "Kharkiv" : "Харків";
  }
  return raw;
}

// Shared website mode: present ONLY real, eligible warehouse offers from the
// site read model. Do not infer replacements, prices, or availability here.
export function formatTelegramOwnStockVariants({ query, cards, locale = "uk" }) {
  const t = COPY[lang(locale)];
  const groups = new Map();

  for (const card of cards || []) {
    const article = String(card?.product?.article || "").trim();
    const url = articleUrl(article, locale);
    if (!url) continue;

    const name = escapeTelegramHtml(String(card.product.name || t.part).slice(0, 180));
    const articleLink = '<a href="' + escapeTelegramHtml(url) + '">'
      + escapeTelegramHtml(article) + '</a>';

    for (const offer of card.offers || []) {
      const quantity = Number(offer?.quantity);
      const price = currency(offer?.retailPrice, locale);
      if (offer?.sourceType !== "OWN_STOCK" ||
          offer?.isAvailable !== true ||
          !Number.isFinite(quantity) || quantity <= 0 || !price) continue;

      // The public site deliberately renders >5 for larger stock quantities.
      // Respect its displayQuantity rather than leaking the raw DB count.
      const count = typeof offer.displayQuantity === "string" &&
        offer.displayQuantity.trim()
        ? offer.displayQuantity.trim()
        : String(quantity);
      const city = localizedWarehouseCity(offer.warehouseCity, locale);
      const key = city.toLocaleLowerCase();
      if (!groups.has(key)) groups.set(key, { city, rows: [] });

      groups.get(key).rows.push(
        "🔎 " + articleLink + " — " + name + "\n"
        + "💰 <b>" + price + "</b>  🟢 <b>" + t.inStock + ": "
        + escapeTelegramHtml(count) + " " + t.pcs + "</b>"
      );
    }
  }

  if (!groups.size) {
    return { text: "❌ <code>" + escapeTelegramHtml(query)
      + "</code> — " + t.noOwnStock };
  }

  return {
    // Preserve each variant as one indivisible item. The batch formatter
    // can then keep requested-number groups intact and print a shared city
    // heading only once across those groups.
    stockEntries: [...groups.values()].flatMap(({ city, rows }) =>
      rows.map(text => ({ city, text }))
    ),
    text: [...groups.values()].map(({ city, rows }) =>
      "🏬 <b>" + t.ownByCity
      + (city ? " " + escapeTelegramHtml(city) : "") + "</b>\n"
      + rows.join("\n")
    ).join("\n"),
  };
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
      + "Send /register to connect your MAKA account from this Telegram chat.\n"
      + "🌐 Change language: /language"
    : "🤖 <b>" + greeting + " Я MAKAtron — робот-помічник MAKA.com.ua.</b>\n"
      + "Надішліть артикул або список до 20 артикулів — по одному в рядку (або через кому чи ;).\n"
      + "Перевірю склад MAKA, пропозиції постачальників, заміни й аналоги.\n"
      + "Надішліть /register, щоб зареєструватися або прив’язати MAKA до цього Telegram.\n"
      + "🌐 Змінити мову: /language" };
}

export function formatTelegramInputError(error, locale = "uk") {
  const t = COPY[lang(locale)];
  const message = error === "TOO_MANY" ? t.tooMany
    : error === "INPUT_LENGTH" ? t.invalidLength : t.invalidArticle;
  return { text: "⚠️ " + message };
}

// The website may return several real, in-stock variants for each submitted
// article. Keep related variants consecutive, with exactly one blank line
// between the distinct submitted queries. The warehouse label is shared
// across all queries when their stock is in the same city.
function formatTelegramStockBatch(results, locale) {
  const t = COPY[lang(locale)];
  const chunks = [];
  const maxLength = 3900;
  for (let start = 0; start < results.length; start += 5) {
    const subset = results.slice(start, start + 5);
    const cities = new Set(subset.flatMap(result =>
      (result.stockEntries || []).map(entry => entry.city)
    ));
    const singleCity = cities.size === 1;
    const header = "<b>MAKAtron · " + t.results + " " + (start + 1)
      + "–" + Math.min(start + 5, results.length) + " " + t.of
      + " " + results.length + "</b>\n\n";
    let text = header;
    let lastRequest = null;
    let lastCity = null;

    const cityHeading = city => "🏬 <b>" + t.ownByCity
      + (city ? " " + escapeTelegramHtml(city) : "") + "</b>\n";

    const flush = () => {
      if (text !== header) chunks.push({
        text, parse_mode: "HTML",
      });
      text = header;
      lastRequest = null;
      lastCity = null;
    };

    // One complete offer line includes both the linked number and its price.
    // Never split that line, which could otherwise break Telegram HTML.
    const append = (body, requestIndex, city = null, stock = false) => {
      const build = () => {
        const separator = lastRequest === null ? ""
          : lastRequest === requestIndex ? "\n" : "\n\n";
        const warehouse = stock && (lastCity === null || lastCity !== city)
          ? cityHeading(city) : "";
        return separator + warehouse + body;
      };
      let addition = build();
      if (text.length + addition.length > maxLength) {
        flush();
        addition = build();
      }
      if (text.length + addition.length > maxLength) {
        throw new Error("Telegram stock variant exceeds message limit");
      }
      text += addition;
      lastRequest = requestIndex;
      if (stock) lastCity = city;
      else lastCity = null;
    };

    for (let i = 0; i < subset.length; i++) {
      const result = subset[i];
      const requestIndex = start + i;
      if (Array.isArray(result.stockEntries) && result.stockEntries.length) {
        for (const { city, text: row } of result.stockEntries) {
          append(row, requestIndex, city, true);
        }
      } else {
        append(String(result.text || ""), requestIndex);
      }
    }
    flush();
  }
  return chunks;
}

// Five queried articles per batch, splitting into additional messages when
// all in-stock variants cannot fit Telegram's 4096-character message limit.
// Split between complete HTML paragraphs so clickable article tags stay intact.
export function formatTelegramBatch(results, locale = "uk") {
  if (results.some(result => Array.isArray(result.stockEntries))) {
    return formatTelegramStockBatch(results, locale);
  }
  const t = COPY[lang(locale)];
  const chunks = [];
  const maxLength = 3900;
  for (let i = 0; i < results.length; i += 5) {
    const header = "<b>MAKAtron · " + t.results + " " + (i + 1) + "–"
      + Math.min(i + 5, results.length) + " " + t.of + " "
      + results.length + "</b>\n\n";
    let text = header;
    const flush = () => {
      if (text !== header) chunks.push({ text, parse_mode: "HTML" });
      text = header;
    };
    for (const result of results.slice(i, i + 5)) {
      const parts = String(result.text || "").split(/\n\n+/).filter(Boolean);
      for (const part of parts) {
        const candidate = (text === header ? "" : "\n\n") + part;
        if (text.length + candidate.length > maxLength) flush();
        if (header.length + part.length > maxLength) {
          // A legacy result might have an unusually large paragraph.
          // Always split at newline boundaries, never in an HTML link.
          for (const line of part.split("\n").filter(Boolean)) {
            const lineCandidate = (text === header ? "" : "\n") + line;
            if (text.length + lineCandidate.length > maxLength) flush();
            if (header.length + line.length > maxLength) {
              throw new Error("Telegram catalog line exceeds message limit");
            }
            text += (text === header ? "" : "\n") + line;
          }
        } else {
          text += (text === header ? "" : "\n\n") + part;
        }
      }
    }
    flush();
  }
  return chunks;
}
