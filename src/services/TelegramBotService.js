import { TelegramConnectionService } from "./TelegramConnectionService.js";

let timer = null;
let offset = 0;
let polling = false;

async function api(method, body = {}) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} error`);
  return data.result;
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const updates = await api("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
    for (const update of updates) {
      offset = Math.max(offset, Number(update.update_id) + 1);
      const message = update.message;
      const match = String(message?.text || "").match(/^\/start\s+([a-f0-9]{48})$/i);
      if (!match || !message?.chat?.id) continue;
      const connection = await TelegramConnectionService.connectFromTelegram({
        token: match[1],
        chatId: message.chat.id,
        username: message.from?.username,
        firstName: message.from?.first_name,
      });
      await api("sendMessage", {
        chat_id: message.chat.id,
        text: connection
          ? "✅ Telegram успешно привязан к AutoHub. Здесь будут приходить уведомления о заказах."
          : "Ссылка устарела или уже использована. Создайте новую ссылку в AutoHub.",
      });
    }
  } catch (error) {
    console.error("Ошибка Telegram-бота:", error.message);
  } finally {
    polling = false;
  }
}

export function startTelegramBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_BOT_USERNAME || timer) {
    if (!process.env.TELEGRAM_BOT_TOKEN) console.log("ℹ️ Telegram-бот не запущен: TELEGRAM_BOT_TOKEN не задан");
    return;
  }
  console.log(`🤖 Telegram-бот @${String(process.env.TELEGRAM_BOT_USERNAME).replace(/^@/, "")} запущен`);
  void poll();
  timer = setInterval(() => void poll(), 3000);
}
