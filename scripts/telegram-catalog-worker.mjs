// Dedicated MAKAtron polling worker; only handles incoming Telegram messages.
// HTTP, scheduled jobs and outgoing order notifications stay on the main backend.
import "dotenv/config";

const expectedUsername = "MAKA_com_ua_bot";
const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const configuredUsername = String(process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "").trim();

if (!token || configuredUsername.toLowerCase() !== expectedUsername.toLowerCase()) {
  throw new Error("MAKAtron worker requires its own token and TELEGRAM_BOT_USERNAME=MAKA_com_ua_bot");
}

// Do not accidentally poll the old bot if the wrong token was copied into
// the isolated worker's .env. getMe does not print the token in logs.
const response = await fetch("https://api.telegram.org/bot" + token + "/getMe", {
  signal: AbortSignal.timeout(10_000),
});
const data = await response.json();
if (!response.ok || data?.ok !== true
  || String(data.result?.username || "").toLowerCase() !== expectedUsername.toLowerCase()) {
  throw new Error("Bot token does not belong to @MAKA_com_ua_bot; worker not started");
}

// Guest-only, no-linking mode is the SAFE DEFAULT. Flip flags explicitly
// only after the active website backend is switched to this bot's token and
// that backend has polling disabled. Existing links can be reused if their
// chat and Telegram user IDs are verified against the new bot.
const linkingEnabled = /^(true|1|yes|on)$/i.test(
  String(process.env.TELEGRAM_BOT_LINKING_ENABLED ?? "false").trim()
);
const guestOnly = !/^(false|0|no|off)$/i.test(
  String(process.env.TELEGRAM_CATALOG_GUEST_ONLY ?? "true").trim()
);
process.env.TELEGRAM_BOT_LINKING_ENABLED = String(linkingEnabled);
process.env.TELEGRAM_CATALOG_GUEST_ONLY = String(guestOnly);
process.env.TELEGRAM_CATALOG_SEARCH_ENABLED = "true";
process.env.TELEGRAM_BOT_POLLING_ENABLED = "true";

const { startTelegramBot } = await import("../src/services/TelegramBotService.js");
startTelegramBot();
console.log("MAKAtron worker ready: link=" + linkingEnabled + ", guestOnly=" + guestOnly);
