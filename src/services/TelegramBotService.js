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
      if (message?.contact && message?.chat?.id && message?.from?.id) {
        const ownsContact = !message.contact.user_id || Number(message.contact.user_id) === Number(message.from.id);
        const verification = ownsContact
          ? await TelegramConnectionService.verifyPhoneFromTelegram({
              chatId:message.chat.id,
              telegramUserId:message.from.id,
              phoneNumber:message.contact.phone_number,
            })
          : {verified:false, locale:"uk", reason:"NOT_OWN_CONTACT"};
        const copy = {
          uk:verification.verified
            ? "✅ Номер підтверджено. Тепер можна надсилати VIN-запити та спілкуватися з менеджером."
            : "Ой, цей номер не збігається з номером у вашому акаунті MAKA. Перевірте номер у профілі або поділіться власним контактом.",
          en:verification.verified
            ? "✅ Phone number confirmed. You can now send VIN requests and chat with a manager."
            : "This number does not match the phone number in your MAKA account. Check your profile number or share your own contact.",
          ru:verification.verified
            ? "✅ Номер подтверждён. Теперь можно отправлять VIN-запросы и общаться с менеджером."
            : "Ой, этот номер не совпадает с номером в вашем аккаунте MAKA. Проверьте номер в профиле или поделитесь своим контактом.",
        };
        await api("sendMessage", {
          chat_id:message.chat.id,
          text:copy[verification.locale] || copy.uk,
          reply_markup:{remove_keyboard:true},
        });
        continue;
      }
      const match = String(message?.text || "").match(/^\/start\s+([a-f0-9]{48})$/i);
      if (!match || !message?.chat?.id) continue;
      const connection = await TelegramConnectionService.connectFromTelegram({
        token: match[1],
        chatId: message.chat.id,
        telegramUserId:message.from?.id,
        username: message.from?.username,
        firstName: message.from?.first_name,
      });
      const connectedCopy = {
        uk:"✅ Telegram успішно підключено до MAKA. Тут надходитимуть сповіщення про замовлення.",
        en:"✅ Telegram is now connected to MAKA. Order notifications will arrive here.",
        ru:"✅ Telegram успешно подключён к MAKA. Здесь будут приходить уведомления о заказах.",
      };
      const verifyCopy = {
        uk:"\n\nЩоб захистити VIN-чат від ботів, підтвердьте номер кнопкою нижче.",
        en:"\n\nTo protect the VIN chat from bots, confirm your phone number using the button below.",
        ru:"\n\nЧтобы защитить VIN-чат от ботов, подтвердите номер кнопкой ниже.",
      };
      const buttonCopy = {uk:"📱 Поділитися моїм номером",en:"📱 Share my phone number",ru:"📱 Поделиться моим номером"};
      await api("sendMessage", {
        chat_id: message.chat.id,
        text: connection
          ? `${connectedCopy[connection.locale] || connectedCopy.uk}${connection.role==="CLIENT"&&!connection.phoneVerified?(verifyCopy[connection.locale]||verifyCopy.uk):""}`
          : "Посилання застаріло або вже використане. Створіть нове посилання в MAKA.",
        ...(connection?.role==="CLIENT"&&!connection.phoneVerified?{
          reply_markup:{keyboard:[[{text:buttonCopy[connection.locale]||buttonCopy.uk,request_contact:true}]],resize_keyboard:true,one_time_keyboard:true},
        }:{}),
      });
    }
  } catch (error) {
    console.error("Ошибка Telegram-бота:", error.message);
  } finally {
    polling = false;
  }
}

export function startTelegramBot() {
  const pollingEnabled = !["false", "0", "no", "off"].includes(
    String(process.env.TELEGRAM_BOT_POLLING_ENABLED ?? "true").trim().toLowerCase()
  );
  if (!pollingEnabled) {
    console.log("ℹ️ Telegram-бот не запущен: polling отключён настройкой");
    return;
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_BOT_USERNAME || timer) {
    if (!process.env.TELEGRAM_BOT_TOKEN) console.log("ℹ️ Telegram-бот не запущен: TELEGRAM_BOT_TOKEN не задан");
    return;
  }
  console.log(`🤖 Telegram-бот @${String(process.env.TELEGRAM_BOT_USERNAME).replace(/^@/, "")} запущен`);
  void poll();
  timer = setInterval(() => void poll(), 3000);
}
