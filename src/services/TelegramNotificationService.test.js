import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVinStaffNotification,
  TelegramNotificationService,
} from "./TelegramNotificationService.js";

const guestRequest = {
  id: 42,
  vin: "WDD2120471A387679",
  request_text: "Потрібні <передні> колодки",
  contact_phone: "+380671234567",
  guest_name: "Іван & Олена",
  vehicle_brand_name: "Mercedes-Benz",
  first_name: null,
  last_name: null,
  email: null,
  user_phone: null,
};

test("формирует полное и безопасное уведомление о гостевом VIN-запросе", () => {
  const notification = buildVinStaffNotification({
    request: guestRequest,
    event: "NEW_REQUEST",
    locale: "ru",
    frontendUrl: "https://maka.com.ua/",
  });

  assert.match(notification.text, /Новый VIN-запрос №42/);
  assert.match(notification.text, /Клиент: Іван &amp; Олена/);
  assert.match(notification.text, /Телефон: <code>\+380671234567<\/code>/);
  assert.match(notification.text, /Марка: Mercedes-Benz/);
  assert.match(notification.text, /VIN: <code>WDD2120471A387679<\/code>/);
  assert.ok(notification.text.includes("Потрібні &lt;передні&gt; колодки"));
  assert.equal(
    notification.reply_markup.inline_keyboard[0][0].url,
    "https://maka.com.ua/ru/admin/vin-requests?request=42"
  );
});

test("отправляет гостевой VIN-запрос всем подключенным сотрудникам", async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("FROM user_telegram_connections")) {
        return {
          rows: [
            { telegram_chat_id: 101, preferred_locale: "uk" },
            { telegram_chat_id: 202, preferred_locale: "en" },
          ],
        };
      }
      return { rows: [guestRequest] };
    },
  };
  const sent = [];
  const transport = async (chatId, payload) => {
    sent.push({ chatId, payload });
  };

  const result = await TelegramNotificationService.sendVinActivityToStaff(
    { requestId: guestRequest.id, event: "NEW_REQUEST" },
    db,
    transport
  );

  assert.deepEqual(sent.map((delivery) => delivery.chatId), [101, 202]);
  assert.match(sent[0].payload.text, /Новий VIN-запит №42/);
  assert.match(sent[1].payload.text, /New VIN request №42/);
  assert.match(queries[0], /r\.name IN \('ADMIN', 'MANAGER'\)/);
  assert.match(queries[0], /u\.is_active = TRUE/);
  assert.match(queries[1], /LEFT JOIN users u ON u\.id = vr\.user_id/);
  assert.deepEqual(result, {
    recipients: 2,
    sent: 2,
    failed: 0,
    skipped: false,
  });
});
