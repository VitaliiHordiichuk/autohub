import { TelegramConnectionService } from "./TelegramConnectionService.js";
import { searchTelegramCatalog } from "./TelegramCatalogService.js";
import { TelegramLanguageService, telegramLanguageKeyboard } from "./TelegramLanguageService.js";
import { handleTelegramOrderMessage, handleTelegramOrderCallback, telegramInlineCheckoutEnabled } from "./TelegramOrderService.js";
import { sendPendingTelegramGuestOrderConfirmations } from "./TelegramGuestOrderNotificationService.js";

let timer = null;
let offset = 0;
let polling = false;
const lastCatalogSearch = new Map();
let lastGuestConfirmationCheck = 0;

function catalogEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.TELEGRAM_CATALOG_SEARCH_ENABLED || "false"));
}

function linkingEnabled() {
  return String(process.env.TELEGRAM_BOT_LINKING_ENABLED ?? "true").trim().toLowerCase() !== "false";
}


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
    const updates = await api("getUpdates", { offset, timeout: 0, allowed_updates: ["message", "callback_query"] });
    for (const update of updates) {
      offset = Math.max(offset, Number(update.update_id) + 1);
      const callback = update.callback_query;
      if (callback && telegramInlineCheckoutEnabled(callback.message?.chat?.id) && String(callback.data || "").startsWith("mo:")) {
        try {
          if (await handleTelegramOrderCallback(callback, api)) continue;
        } catch (error) {
          console.error("MAKAtron order callback:", error.message);
          await api("answerCallbackQuery", { callback_query_id: callback.id,
            text: "⚠️ Не вдалося оновити замовлення. Спробуйте ще раз." }).catch(() => {});
        }
        continue;
      }
      if (callback && /^lang:(uk|en)$/.test(String(callback.data || ""))) {
        const chat = callback.message?.chat;
        if (chat?.type === "private" && String(chat.id) === String(callback.from?.id)) {
          const locale = callback.data.slice(5);
          await TelegramLanguageService.set(chat.id, locale);
          await api("answerCallbackQuery", { callback_query_id: callback.id,
            text: locale === "en" ? "English selected" : "Обрано українську" });
          await api("editMessageReplyMarkup", { chat_id: chat.id,
            message_id: callback.message.message_id,
            reply_markup: telegramLanguageKeyboard(locale) });
          await api("sendMessage", { chat_id: chat.id,
            text: locale === "en" ? "✅ Language: English. Send a part number."
              : "✅ Мова: українська. Надішліть артикул." });
        } else {
          await api("answerCallbackQuery", { callback_query_id: callback.id });
        }
        continue;
      }
      const message = update.message;
      const command = String(message?.text || "").trim().toLowerCase();
      // Private-only command to discover the exact pilot chat ID.
      // Never expose contact details, customer records or a bot token.
      if (message?.chat?.type === "private" &&
          String(message.chat.id) === String(message.from?.id) &&
          (command === "/myid" || command === "/myid@maka_com_ua_bot")) {
        const locale = await TelegramLanguageService.get(message.chat.id);
        await api("sendMessage", { chat_id: message.chat.id,
          text: locale === "en"
            ? "Your Telegram ID: " + message.from.id
            : "Ваш Telegram ID: " + message.from.id });
        continue;
      }
      if (message?.chat?.type === "private" &&
          String(message.chat.id) === String(message.from?.id) &&
          /^\/(?:language|lang|uk|en)(?:@maka_com_ua_bot)?$/.test(command)) {
        const desired = command.match(/^\/(uk|en)(?:@|$)/)?.[1];
        const locale = desired
          ? await TelegramLanguageService.set(message.chat.id, desired)
          : await TelegramLanguageService.get(message.chat.id);
        await api("sendMessage", { chat_id: message.chat.id,
          text: desired
            ? locale === "en" ? "✅ Language: English." : "✅ Мова: українська."
            : locale === "en" ? "🌐 Choose a language:" : "🌐 Оберіть мову:",
          reply_markup: telegramLanguageKeyboard(locale),
        });
        continue;
      }
      // Isolated MAKAtron guest preview must not modify legacy phone verification.
      if (!linkingEnabled() && message?.contact && message?.chat?.id) {
        await api("sendMessage", { chat_id: message.chat.id,
          text: "Прив'язка профілю MAKAtron наразі недоступна. Надішліть артикул для пошуку." });
        continue;
      }
      if (message?.contact && message?.chat?.id && message?.from?.id) {
        const ownsContact = !message.contact.user_id || Number(message.contact.user_id) === Number(message.from.id);
        const verification = ownsContact
          ? await TelegramConnectionService.verifyPhoneFromTelegram({
              chatId:message.chat.id,
              telegramUserId:message.from.id,
              phoneNumber:message.contact.phone_number,
            })
          : {verified:false, locale:"uk", reason:"NOT_OWN_CONTACT"};
        const locale = await TelegramLanguageService.get(message.chat.id);
        const copy = {
          uk:verification.verified
            ? "✅ Номер підтверджено. Тепер можна надсилати VIN-запити та спілкуватися з менеджером."
            : "Ой, цей номер не збігається з номером у вашому акаунті MAKA. Перевірте номер у профілі або поділіться власним контактом.",
          en:verification.verified
            ? "✅ Phone number confirmed. You can now send VIN requests and chat with a manager."
            : "This number does not match the phone number in your MAKA account. Check your profile number or share your own contact.",
        };
        await api("sendMessage", {
          chat_id:message.chat.id,
          text:copy[locale],
          reply_markup:{remove_keyboard:true},
        });
        continue;
      }
      const match = String(message?.text || "").match(/^\/start\s+([a-f0-9]{48})$/i);
      if (!linkingEnabled() && match && message?.chat?.id) {
        await api("sendMessage", { chat_id: message.chat.id,
          text: "Прив'язка акаунта MAKA до нового бота ще не ввімкнена. Можете шукати запчастини за артикулом." });
        continue;
      }
      if (match && message?.chat?.id) {
      const connection = await TelegramConnectionService.connectFromTelegram({
        token: match[1],
        chatId: message.chat.id,
        telegramUserId:message.from?.id,
        username: message.from?.username,
        firstName: message.from?.first_name,
      });
      const locale = await TelegramLanguageService.get(message.chat.id);
      const connectedCopy = {
        uk:"✅ Telegram успішно підключено до MAKA. Тут надходитимуть сповіщення про замовлення.",
        en:"✅ Telegram is now connected to MAKA. Order notifications will arrive here.",
      };
      const verifyCopy = {
        uk:"\n\nЩоб захистити VIN-чат від ботів, підтвердьте номер кнопкою нижче.",
        en:"\n\nTo protect the VIN chat from bots, confirm your phone number using the button below.",
      };
      const buttonCopy = {uk:"📱 Поділитися моїм номером",en:"📱 Share my phone number"};
      const linkedName = connection?.role === "CLIENT"
        ? String(connection.firstName || "").trim().replace(/[\r\n\t]/g, " ").slice(0, 60)
        : "";
      const hello = locale === "en" ? "Hello" : "Привіт";
      const greeting = "🤖 " + hello + (linkedName ? ", " + linkedName : "") + "! " +
        (locale === "en" ? "I’m MAKAtron.\n\n" : "Я MAKAtron.\n\n");
      await api("sendMessage", {
        chat_id: message.chat.id,
        text: connection
          ? `${greeting}${connectedCopy[locale]}${connection.role==="CLIENT"&&!connection.phoneVerified?verifyCopy[locale]:""}`
          : (locale === "en" ? "This link expired or was already used. Create a new link in MAKA." : "Посилання застаріло або вже використане. Створіть нове посилання в MAKA."),
        ...(connection?.role==="CLIENT"&&!connection.phoneVerified?{
          reply_markup:{keyboard:[[{text:buttonCopy[locale],request_contact:true}]],resize_keyboard:true,one_time_keyboard:true},
        }:{}),
      });
        if (connection) {
          await api("sendMessage", { chat_id: message.chat.id,
            text: locale === "en" ? "🌐 Choose a language:" : "🌐 Оберіть мову:",
            reply_markup: telegramLanguageKeyboard(locale) });
        }
        continue;
      }
      // Search is optional and only runs in private chats. Existing /start links
      // and contact verification remain active regardless of this feature flag.
      const text = String(message?.text || "").trim();
      if (!catalogEnabled() || message?.chat?.type !== "private" ||
          !message?.chat?.id || !message?.from?.id || !text) continue;
      // Checkout inputs (recipient, optional comment) should never be
      // blocked by the catalogue-search 3-second throttle.
      if (telegramInlineCheckoutEnabled(message.chat.id) && !text.startsWith("/")) {
        try {
          if (await handleTelegramOrderMessage({
            text, chatId: message.chat.id, telegramUserId: message.from.id,
          }, api)) continue;
        } catch(error) {
          console.error("MAKAtron order message:",error.message);
          await api("sendMessage",{chat_id:message.chat.id,
            text:(await TelegramLanguageService.get(message.chat.id))==="en"
              ?"⚠️ Could not update your order. Please try again."
              :"⚠️ Не вдалося оновити замовлення. Спробуйте ще раз."});
          continue;
        }
      }
      const key = String(message.from.id);
      const now = Date.now();
      if (now - (lastCatalogSearch.get(key) || 0) < 3000) {
        await api("sendMessage", { chat_id: message.chat.id,
          text: (await TelegramLanguageService.get(message.chat.id)) === "en"
            ? "⏳ Please try again in a few seconds." : "⏳ Спробуйте ще раз за кілька секунд." });
        continue;
      }
      lastCatalogSearch.set(key, now);
      // Bound in-memory throttling entries; no permanent client history.
      if (lastCatalogSearch.size > 1000) lastCatalogSearch.clear();
      const replies = await searchTelegramCatalog({
        text, chatId: message.chat.id, telegramUserId: message.from.id,
      });
      for (const reply of replies) {
        const showLanguages = /^\/(start|help)(?:\s|$)/i.test(text);
        await api("sendMessage", { chat_id: message.chat.id,
          ...reply,
          ...(showLanguages ? { reply_markup: telegramLanguageKeyboard(await TelegramLanguageService.get(message.chat.id)) } : {}),
        });
      }
    }
  } catch (error) {
    console.error("Помилка Telegram-бота:", error.message);
  } finally {
    // This process already owns the MAKAtron Telegram token. Guest
    // confirmations are driven by the manager's order status in the database,
    // without needing to redeploy the public website backend.
    const now=Date.now();
    if (telegramInlineCheckoutEnabled(
      process.env.TELEGRAM_INLINE_CHECKOUT_TEST_CHAT_ID||null
    ) && now-lastGuestConfirmationCheck>=15000) {
      lastGuestConfirmationCheck=now;
      try { await sendPendingTelegramGuestOrderConfirmations(api); }
      catch(error) { console.error("MAKAtron guest status checks:",error.message); }
    }
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
