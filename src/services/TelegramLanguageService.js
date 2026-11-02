import { pool } from "../config/db.js";

// Telegram is Ukrainian by default, regardless of the website language.
// English is enabled only by the person choosing it in this chat.
export function normalizeTelegramLocale(value) {
  return value === "en" ? "en" : "uk";
}

export const TelegramLanguageService = {
  async get(chatId, db = pool) {
    if (!chatId) return "uk";
    const { rows } = await db.query(
      "SELECT locale FROM telegram_bot_locales WHERE chat_id = $1",
      [chatId],
    );
    return normalizeTelegramLocale(rows[0]?.locale);
  },
  async set(chatId, locale, db = pool) {
    if (!chatId || !["uk", "en"].includes(locale)) {
      throw new Error("Invalid Telegram chat or language");
    }
    await db.query(`
      INSERT INTO telegram_bot_locales(chat_id, locale)
      VALUES ($1, $2)
      ON CONFLICT (chat_id)
      DO UPDATE SET locale = EXCLUDED.locale, updated_at = CURRENT_TIMESTAMP
    `, [chatId, locale]);
    return locale;
  },
};

export function telegramLanguageKeyboard(locale = "uk") {
  return { inline_keyboard: [[
    { text: locale === "uk" ? "✅ 🇺🇦 Українська" : "🇺🇦 Українська", callback_data: "lang:uk" },
    { text: locale === "en" ? "✅ 🇬🇧 English" : "🇬🇧 English", callback_data: "lang:en" },
  ]] };
}
