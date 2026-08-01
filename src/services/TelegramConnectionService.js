import { createHash, randomBytes } from "node:crypto";
import { pool } from "../config/db.js";
import { transaction } from "../db/transaction.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalizeLocale = (value) => ["uk", "en", "ru"].includes(value) ? value : "uk";

export const TelegramConnectionService = {
  async status(userId, db = pool) {
    const result = await db.query(`
      SELECT telegram_username, telegram_first_name, notifications_enabled, linked_at
      FROM user_telegram_connections WHERE user_id = $1`, [userId]);
    const row = result.rows[0];
    return row ? {
      connected: true,
      username: row.telegram_username,
      firstName: row.telegram_first_name,
      notificationsEnabled: row.notifications_enabled,
      linkedAt: row.linked_at,
    } : { connected: false };
  },

  async createLink(userId, locale, db = pool) {
    const botUsername = String(process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "").trim();
    if (!process.env.TELEGRAM_BOT_TOKEN || !botUsername) {
      const error = new Error("Telegram-бот ещё не настроен");
      error.code = "TELEGRAM_NOT_CONFIGURED";
      throw error;
    }
    const token = randomBytes(24).toString("hex");
    await db.query("DELETE FROM telegram_link_tokens WHERE user_id = $1 OR expires_at < CURRENT_TIMESTAMP", [userId]);
    await db.query(`
      INSERT INTO telegram_link_tokens(user_id, token_hash, expires_at, locale)
      VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '15 minutes', $3)`, [userId, hash(token), normalizeLocale(locale)]);
    return { url: `https://t.me/${botUsername}?start=${token}`, expiresInMinutes: 15 };
  },

  async connectFromTelegram({ token, chatId, username, firstName }) {
    return transaction(async (db) => {
      const result = await db.query(`
        SELECT t.id, t.user_id, t.locale
        FROM telegram_link_tokens t
        JOIN users u ON u.id = t.user_id
        JOIN roles r ON r.id = u.role_id
        WHERE t.token_hash = $1 AND t.used_at IS NULL
          AND t.expires_at > CURRENT_TIMESTAMP AND u.is_active = TRUE
          AND r.name IN ('ADMIN', 'MANAGER', 'CLIENT')
        FOR UPDATE`, [hash(token)]);
      const link = result.rows[0];
      if (!link) return null;
      await db.query(`
        INSERT INTO user_telegram_connections(
          user_id, telegram_chat_id, telegram_username, telegram_first_name, preferred_locale
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) DO UPDATE SET
          telegram_chat_id = EXCLUDED.telegram_chat_id,
          telegram_username = EXCLUDED.telegram_username,
          telegram_first_name = EXCLUDED.telegram_first_name,
          preferred_locale = EXCLUDED.preferred_locale,
          notifications_enabled = TRUE,
          updated_at = CURRENT_TIMESTAMP`, [link.user_id, chatId, username || null, firstName || null, normalizeLocale(link.locale)]);
      await db.query("UPDATE telegram_link_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1", [link.id]);
      return { userId: link.user_id, locale:normalizeLocale(link.locale) };
    });
  },

  async disconnect(userId, db = pool) {
    await db.query("DELETE FROM user_telegram_connections WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM telegram_link_tokens WHERE user_id = $1", [userId]);
  },
};
