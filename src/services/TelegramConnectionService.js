import { createHash, randomBytes } from "node:crypto";
import { pool } from "../config/db.js";
import { transaction } from "../db/transaction.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalizeLocale = (value) => value === "en" ? "en" : "uk";
const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits)) return `+38${digits}`;
  if (/^380\d{9}$/.test(digits)) return `+${digits}`;
  return digits ? `+${digits}` : "";
};

export const TelegramConnectionService = {
  async status(userId, db = pool) {
    const result = await db.query(`
      SELECT c.telegram_username, c.telegram_first_name, c.notifications_enabled, c.linked_at,
        u.phone, u.phone_verified_at, u.phone_verified_value
      FROM user_telegram_connections c
      JOIN users u ON u.id=c.user_id
      WHERE c.user_id = $1`, [userId]);
    const row = result.rows[0];
    return row ? {
      connected: true,
      username: row.telegram_username,
      firstName: row.telegram_first_name,
      notificationsEnabled: row.notifications_enabled,
      linkedAt: row.linked_at,
      phoneVerified: Boolean(row.phone_verified_at && normalizePhone(row.phone) === normalizePhone(row.phone_verified_value)),
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

  async connectFromTelegram({ token, chatId, telegramUserId, username, firstName }) {
    return transaction(async (db) => {
      const result = await db.query(`
        SELECT t.id, t.user_id, t.locale, u.phone, u.phone_verified_at, u.phone_verified_value, r.name AS role_name
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
          user_id, telegram_chat_id, telegram_user_id, telegram_username, telegram_first_name, preferred_locale
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id) DO UPDATE SET
          telegram_chat_id = EXCLUDED.telegram_chat_id,
          telegram_user_id = EXCLUDED.telegram_user_id,
          telegram_username = EXCLUDED.telegram_username,
          telegram_first_name = EXCLUDED.telegram_first_name,
          preferred_locale = EXCLUDED.preferred_locale,
          notifications_enabled = TRUE,
          updated_at = CURRENT_TIMESTAMP`, [link.user_id, chatId, telegramUserId || null, username || null, firstName || null, normalizeLocale(link.locale)]);
      await db.query("UPDATE telegram_link_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1", [link.id]);
      return {
        userId:link.user_id,
        locale:normalizeLocale(link.locale),
        role:link.role_name,
        phoneVerified:Boolean(link.phone_verified_at && normalizePhone(link.phone) === normalizePhone(link.phone_verified_value)),
      };
    });
  },

  async verifyPhoneFromTelegram({chatId, telegramUserId, phoneNumber}) {
    return transaction(async (db) => {
      const result = await db.query(`
        SELECT c.user_id, c.preferred_locale, u.phone
        FROM user_telegram_connections c
        JOIN users u ON u.id=c.user_id
        JOIN roles r ON r.id=u.role_id
        WHERE c.telegram_chat_id=$1 AND c.telegram_user_id=$2
          AND u.is_active=TRUE AND r.name='CLIENT'
        FOR UPDATE OF u`, [chatId, telegramUserId]);
      if (!result.rows.length) return {verified:false, locale:"uk", reason:"CONNECTION_NOT_FOUND"};
      const supplied = normalizePhone(phoneNumber);
      const matching = result.rows.filter((row) => normalizePhone(row.phone) === supplied);
      if (!matching.length) return {verified:false, locale:normalizeLocale(result.rows[0].preferred_locale), reason:"PHONE_MISMATCH"};
      await db.query(`UPDATE users SET phone_verified_at=CURRENT_TIMESTAMP, phone_verified_value=phone
        WHERE id=ANY($1::int[])`, [matching.map((row) => Number(row.user_id))]);
      return {verified:true, locale:normalizeLocale(matching[0].preferred_locale), userIds:matching.map((row) => Number(row.user_id))};
    });
  },

  async disconnect(userId, db = pool) {
    await db.query("DELETE FROM user_telegram_connections WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM telegram_link_tokens WHERE user_id = $1", [userId]);
  },
};
