// Dedicated MAKAtron Telegram polling worker. Does NOT start HTTP, jobs,
// order notifications, or modify account links in this preview mode.
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

// Force read-only guest testing until old and new bot account links are
// isolated and customers explicitly relink to the new bot.
process.env.TELEGRAM_BOT_LINKING_ENABLED = "false";
process.env.TELEGRAM_CATALOG_GUEST_ONLY = "true";
process.env.TELEGRAM_CATALOG_SEARCH_ENABLED = "true";
process.env.TELEGRAM_BOT_POLLING_ENABLED = "true";

const { startTelegramBot } = await import("../src/services/TelegramBotService.js");
startTelegramBot();
console.log("MAKAtron isolated catalogue worker started (guest-only, linking disabled)");
