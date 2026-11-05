import { createHash, randomBytes } from "node:crypto";
import { pool } from "../config/db.js";
import { transaction } from "../db/transaction.js";

const tokenHash = (value) =>
  createHash("sha256").update(value).digest("hex");
const validToken = (value) =>
  typeof value === "string" && /^[a-f0-9]{48}$/i.test(value);
const safeLocale = (value) => value === "en" ? "en" : "uk";

function privateIdentity(chatId, telegramUserId) {
  const chat = Number(chatId);
  const sender = Number(telegramUserId);
  if (!Number.isSafeInteger(chat) || chat <= 0 ||
      !Number.isSafeInteger(sender) || sender <= 0 || chat !== sender) {
    throw new Error("A verified private Telegram sender is required");
  }
  return { chat, sender };
}

// This is the sole client-identity transfer used by both website -> Telegram
// and Telegram -> website flows. Staff links are deliberately left intact.
// The advisory transaction lock serializes simultaneous links for one sender.
export async function bindVerifiedTelegramClient({
  userId, chatId, telegramUserId, username = null,
  firstName = null, locale = "uk",
}, db) {
  const { chat, sender } = privateIdentity(chatId, telegramUserId);
  const uid = Number(userId);
  if (!Number.isSafeInteger(uid) || uid <= 0) {
    throw new Error("A valid website account is required");
  }

  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('maka_tg_client'), hashtext($1::text))",
    [sender],
  );
  // 045 intentionally permits staff and client accounts on one private chat.
  // Remove only stale CLIENT mappings before linking the authenticated account.
  await db.query(
    "DELETE FROM user_telegram_connections c USING users u, roles r " +
      "WHERE c.user_id=u.id AND r.id=u.role_id AND r.name='CLIENT' " +
      "AND c.user_id <> $1 " +
      "AND (c.telegram_chat_id=$2 OR c.telegram_user_id=$3)",
    [uid, chat, sender],
  );
  await db.query(
    "INSERT INTO user_telegram_connections(" +
      "user_id,telegram_chat_id,telegram_user_id,telegram_username," +
      "telegram_first_name,preferred_locale) " +
      "VALUES ($1,$2,$3,$4,$5,$6) " +
      "ON CONFLICT (user_id) DO UPDATE SET " +
      "telegram_chat_id=EXCLUDED.telegram_chat_id," +
      "telegram_user_id=EXCLUDED.telegram_user_id," +
      "telegram_username=EXCLUDED.telegram_username," +
      "telegram_first_name=EXCLUDED.telegram_first_name," +
      "preferred_locale=EXCLUDED.preferred_locale," +
      "notifications_enabled=TRUE,updated_at=CURRENT_TIMESTAMP",
    [uid, chat, sender, username, firstName, safeLocale(locale)],
  );
}

// A guest can initiate registration from their own MAKAtron private chat.
// Only this bot has access to the Telegram sender ID: the site receives a
// single-use random proof instead of trusting user-supplied Telegram IDs.
export async function createTelegramRegistrationLink({
  chatId, telegramUserId, username = null, firstName = null, locale = "uk",
}, db = pool) {
  const { chat, sender } = privateIdentity(chatId, telegramUserId);
  const linked = await db.query(
    "SELECT c.user_id FROM user_telegram_connections c " +
      "JOIN users u ON u.id=c.user_id " +
      "JOIN roles r ON r.id=u.role_id " +
      "WHERE c.telegram_chat_id=$1 AND c.telegram_user_id=$2 " +
      "AND u.is_active=TRUE AND r.name='CLIENT' LIMIT 2",
    [chat, sender],
  );
  if (linked.rows.length === 1) {
    return { alreadyLinked: true, url: null };
  }
  if (linked.rows.length > 1) {
    // Only an explicit website -> Telegram re-link can repair this case.
    return { alreadyLinked: false, ambiguous: true, url: null };
  }

  const token = randomBytes(24).toString("hex");
  await db.query(
    "INSERT INTO telegram_registration_claims(" +
      "telegram_user_id,telegram_chat_id,telegram_username," +
      "telegram_first_name,preferred_locale,token_hash,expires_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP + INTERVAL '15 minutes') " +
      "ON CONFLICT (telegram_user_id) DO UPDATE SET " +
      "telegram_chat_id=EXCLUDED.telegram_chat_id," +
      "telegram_username=EXCLUDED.telegram_username," +
      "telegram_first_name=EXCLUDED.telegram_first_name," +
      "preferred_locale=EXCLUDED.preferred_locale," +
      "token_hash=EXCLUDED.token_hash," +
      "expires_at=EXCLUDED.expires_at," +
      "used_at=NULL,created_at=CURRENT_TIMESTAMP",
    [sender, chat, username, firstName, safeLocale(locale), tokenHash(token)],
  );
  return {
    alreadyLinked: false,
    expiresInMinutes: 15,
    url: "https://maka.com.ua/" + safeLocale(locale) +
      "/register?tg=" + encodeURIComponent(token),
  };
}

// Called inside AuthService.register's *existing* transaction. If the token
// is invalid/expired, registration rolls back as a whole; no half-linked user.
export async function claimTelegramRegistrationLink({
  token, userId,
}, db) {
  if (!validToken(token)) {
    const error = new Error("Telegram registration link is invalid");
    error.statusCode = 400;
    error.apiCode = "TELEGRAM_LINK_INVALID";
    throw error;
  }
  const claim = (await db.query(
    "SELECT telegram_chat_id,telegram_user_id,telegram_username," +
      "telegram_first_name,preferred_locale " +
      "FROM telegram_registration_claims " +
      "WHERE token_hash=$1 AND used_at IS NULL " +
      "AND expires_at>CURRENT_TIMESTAMP FOR UPDATE",
    [tokenHash(token)],
  )).rows[0];
  if (!claim) {
    const error = new Error("Telegram registration link has expired or was used");
    error.statusCode = 400;
    error.apiCode = "TELEGRAM_LINK_EXPIRED";
    throw error;
  }
  await bindVerifiedTelegramClient({
    userId,
    chatId: claim.telegram_chat_id,
    telegramUserId: claim.telegram_user_id,
    username: claim.telegram_username,
    firstName: claim.telegram_first_name,
    locale: claim.preferred_locale,
  }, db);
  await db.query(
    "UPDATE telegram_registration_claims " +
      "SET used_at=CURRENT_TIMESTAMP WHERE token_hash=$1",
    [tokenHash(token)],
  );
  return true;
}

// Existing customers can use a MAKAtron-issued link as well: authenticate
// on the website, then claim the same proof. Requires current CLIENT session.
export async function claimTelegramRegistrationForExistingClient({
  token, userId,
}) {
  return transaction(async (db) => {
    const access = (await db.query(
      "SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id " +
        "JOIN customers c ON c.user_id=u.id AND c.is_active=TRUE " +
        "WHERE u.id=$1 AND u.is_active=TRUE AND r.name='CLIENT'",
      [userId],
    )).rows[0];
    if (!access) {
      const error = new Error("An active client account is required");
      error.statusCode = 403;
      throw error;
    }
    return claimTelegramRegistrationLink({ token, userId }, db);
  });
}
