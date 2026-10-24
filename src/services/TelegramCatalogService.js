import { pool } from "../config/db.js";
import { SearchService } from "./SearchService.js";
import { ProductCardService } from "./ProductCardService.js";
import { PublicSearchPresenterService } from "./PublicSearchPresenterService.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { TelegramLanguageService } from "./TelegramLanguageService.js";
import {
  parseTelegramArticles, formatTelegramProduct, formatTelegramNotFound,
  formatTelegramInputError, formatTelegramBatch, formatTelegramHelp,
} from "./TelegramCatalogFormatter.js";

// Telegram identity is trusted only when BOTH the chat and sending user
// match a currently active, uniquely linked MAKA client. No staff price matrix.
export async function resolveTelegramPricingIdentity({ chatId, telegramUserId }, db = pool) {
  // A new bot must never reuse personal-price identity from an old bot.
  if (process.env.TELEGRAM_CATALOG_GUEST_ONLY === "true") return null;
  if (!chatId || !telegramUserId) return null;
  const result = await db.query(
    "SELECT c.user_id, c.preferred_locale, u.first_name "
    + "FROM user_telegram_connections c "
    + "JOIN users u ON u.id = c.user_id "
    + "JOIN roles r ON r.id = u.role_id "
    + "WHERE c.telegram_chat_id = $1 AND c.telegram_user_id = $2 "
    + "AND u.is_active = TRUE AND r.name = 'CLIENT' LIMIT 2",
    [chatId, telegramUserId],
  );
  // Ambiguous mappings fall back to guest; never choose another person's price.
  return result.rows.length === 1
    ? { userId: Number(result.rows[0].user_id), locale: result.rows[0].preferred_locale,
        firstName: result.rows[0].first_name || null }
    : null;
}

const deps = {
  resolveViewer: resolveTelegramPricingIdentity,
  getLocale: TelegramLanguageService.get,
  pricing: CustomerPricingService.getContext,
  search: SearchService.searchByArticle,
  buildCard: ProductCardService.build,
  present: PublicSearchPresenterService.present,
};

export async function searchTelegramCatalog({ text, chatId, telegramUserId }, overrides = {}) {
  const services = { ...deps, ...overrides };
  const raw = String(text || "").trim();
  const locale = await services.getLocale(chatId);
  if (!raw || /^\/start(?:\s|$)/i.test(raw)) {
    const viewer = await services.resolveViewer({ chatId, telegramUserId });
    return [formatTelegramHelp({ firstName: viewer?.firstName, locale })];
  }
  if (/^\/help(?:\s|$)/i.test(raw)) {
    return [formatTelegramHelp({ firstName: null, locale })];
  }
  if (raw.startsWith("/")) return []; // Existing commands are managed elsewhere.

  const parsed = parseTelegramArticles(raw);
  if (parsed.error) return [formatTelegramInputError(parsed.error, locale)];
  const viewer = await services.resolveViewer({ chatId, telegramUserId });

  // Never use a staff account ID for CustomerPricingService: it can produce
  // a priceMatrix containing other customers' prices.
  const pricingContext = await services.pricing(viewer?.userId ?? null);
  const results = [];
  for (const article of parsed.articles) {
    try {
      const found = await services.search(article);
      if (!found?.found) {
        results.push(formatTelegramNotFound(article, locale));
        continue;
      }
      // When the article resolves via a Mercedes family/prefix, still present
      // the resolved product instead of reporting a false "not found".
      const product = found.exactProduct || found.family?.[0] || null;
      if (!product) {
        results.push(formatTelegramNotFound(article));
        continue;
      }
      const rawCard = await services.buildCard(
        product, pricingContext, { userId: viewer?.userId ?? null, cartId: null },
      );
      const view = await services.present({
        requestedLocale: locale,
        productCard: rawCard,
        includeSourceDetails: false,
      });
      const finalReplacement = (found.replacementPath || [])
        .filter((item) => item.linkType === "REPLACEMENT").at(-1);
      results.push(formatTelegramProduct({
        query: article,
        card: view.productCard,
        locale: view.locale || locale,
        replacementArticle: finalReplacement?.targetArticle || null,
        compact: parsed.articles.length > 1,
      }));
    } catch (error) {
      console.error("Telegram catalogue lookup failed:", error);
      results.push({ text: (locale === "en" ? "⚠️ Could not check <code>" : "⚠️ Не вдалося перевірити <code>")
        + article.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        + (locale === "en" ? "</code>. Please try again later." : "</code>. Спробуйте пізніше.") });
    }
  }
  if (results.length === 1) {
    return [{ parse_mode: "HTML", ...results[0] }];
  }
  return formatTelegramBatch(results, locale);
}
