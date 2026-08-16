import { pool } from "../config/db.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatMoney(value) {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function localeOf(value) {
  return value === "en" ? "en" : "uk";
}

async function sendMessage(chatId, payload) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", ...payload }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || "Telegram sendMessage error");
}

export const TelegramNotificationService = {
  async sendVinActivityToStaff({ requestId, event, message = "" }, db = pool) {
    if (process.env.NODE_ENV === "test" || !process.env.TELEGRAM_BOT_TOKEN) return;
    const [connections, requestResult] = await Promise.all([
      db.query(`
        SELECT DISTINCT c.telegram_chat_id
        FROM user_telegram_connections c
        JOIN users u ON u.id = c.user_id
        JOIN roles r ON r.id = u.role_id
        WHERE c.notifications_enabled = TRUE
          AND u.is_active = TRUE
          AND r.name IN ('ADMIN', 'MANAGER')`),
      db.query(`
        SELECT vr.id, vr.vin, vr.request_text, u.first_name, u.last_name, u.email
        FROM vin_requests vr
        JOIN users u ON u.id = vr.user_id
        WHERE vr.id = $1`, [Number(requestId)]),
    ]);
    if (!connections.rows.length || !requestResult.rows[0]) return;

    const request = requestResult.rows[0];
    const customerName = [request.first_name, request.last_name].filter(Boolean).join(" ")
      || request.email
      || "Не вказано";
    const isMessage = event === "CLIENT_MESSAGE";
    const body = String(isMessage ? message : request.request_text).trim();
    const shortened = body.length > 700 ? `${body.slice(0, 697)}…` : body;
    const text = [
      isMessage
        ? `💬 <b>Нове повідомлення у VIN-запиті №${Number(request.id)}</b>`
        : `🔎 <b>Новий VIN-запит №${Number(request.id)}</b>`,
      `Клієнт: ${escapeHtml(customerName)}`,
      `VIN: <code>${escapeHtml(request.vin)}</code>`,
      "",
      escapeHtml(shortened || "Без тексту"),
    ].join("\n");
    const frontendUrl = String(process.env.FRONTEND_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
    const canOpen = /^https:\/\//i.test(frontendUrl);
    const requestUrl = `${frontendUrl}/uk/admin/vin-requests?request=${Number(request.id)}`;
    const deliveries = await Promise.allSettled(connections.rows.map((row) => sendMessage(
      row.telegram_chat_id,
      {
        text,
        ...(canOpen ? {
          reply_markup: {
            inline_keyboard: [[{ text: "Відкрити VIN-запит", url: requestUrl }]],
          },
        } : {}),
      }
    )));
    deliveries.forEach((delivery) => {
      if (delivery.status === "rejected") {
        console.error(
          "Не вдалося надіслати Telegram-сповіщення про VIN-запит:",
          delivery.reason?.message || delivery.reason
        );
      }
    });
  },

  async sendNewOrder({
    orderId,
    customerName,
    totalAmount,
    itemsCount,
    vinCheckRequested = false,
    vin = null,
  }, db = pool) {
    if (process.env.NODE_ENV === "test" || !process.env.TELEGRAM_BOT_TOKEN) return;
    const result = await db.query(`
      SELECT DISTINCT c.telegram_chat_id
      FROM user_telegram_connections c
      JOIN users u ON u.id = c.user_id
      JOIN roles r ON r.id = u.role_id
      WHERE c.notifications_enabled = TRUE AND u.is_active = TRUE
        AND r.name IN ('ADMIN', 'MANAGER')`);
    if (!result.rows.length) return;

    const frontendUrl = String(process.env.FRONTEND_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
    const orderUrl = `${frontendUrl}/uk/admin/orders/${Number(orderId)}`;
    const canOpenOrderFromTelegram = /^https:\/\//i.test(frontendUrl);
    const text = [
      `🛒 <b>Нове замовлення №${Number(orderId)}</b>`,
      `Клієнт: ${escapeHtml(customerName || "Не вказано")}`,
      `Позицій: ${Number(itemsCount || 0)}`,
      `Сума: <b>${escapeHtml(formatMoney(totalAmount))}</b>`,
      ...(vinCheckRequested ? [
        "",
        "⚠️ <b>ПЕРЕВІРИТИ СУМІСНІСТЬ ДО ПІДТВЕРДЖЕННЯ</b>",
        `VIN: <code>${escapeHtml(vin)}</code>`,
      ] : []),
    ].join("\n");

    const deliveries = await Promise.allSettled(result.rows.map((row) =>
      sendMessage(row.telegram_chat_id, {
        text,
        ...(canOpenOrderFromTelegram ? {
          reply_markup: { inline_keyboard: [[{ text: "Відкрити замовлення", url: orderUrl }]] },
        } : {}),
      })
    ));
    deliveries.forEach((delivery) => {
      if (delivery.status === "rejected") console.error("Не удалось отправить Telegram-уведомление:", delivery.reason?.message || delivery.reason);
    });
  },

  async sendOrderStatusToUser({ userId, orderId, status }, db = pool) {
    if (process.env.NODE_ENV === "test" || !process.env.TELEGRAM_BOT_TOKEN || !userId) return;
    const [connectionResult, orderResult, itemsResult] = await Promise.all([
      db.query(`SELECT telegram_chat_id, preferred_locale FROM user_telegram_connections
        WHERE user_id = $1 AND notifications_enabled = TRUE`, [userId]),
      db.query("SELECT total_amount FROM orders WHERE id = $1", [orderId]),
      db.query(`SELECT p.article, p.name, oi.quantity
        FROM order_items oi JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1 AND oi.status = 'ACTIVE' ORDER BY oi.id`, [orderId]),
    ]);
    if (!connectionResult.rows[0]) return;

    const locale = localeOf(connectionResult.rows[0].preferred_locale);
    const copy = {
      uk:{ CONFIRMED:"✅ Ваше замовлення підтверджено", COMPLETED:"🎉 Ваше замовлення завершено", CANCELLED:"↩️ Ваше замовлення скасовано", order:"Замовлення", total:"Сума", more:"і ще", open:"Переглянути замовлення" },
      en:{ CONFIRMED:"✅ Your order has been confirmed", COMPLETED:"🎉 Your order has been completed", CANCELLED:"↩️ Your order has been cancelled", order:"Order", total:"Total", more:"more", open:"View order" },
      ru:{ CONFIRMED:"✅ Ваш заказ подтверждён", COMPLETED:"🎉 Ваш заказ завершён", CANCELLED:"↩️ Ваш заказ отменён", order:"Заказ", total:"Сумма", more:"и ещё", open:"Посмотреть заказ" },
    }[locale];
    const labels = { CONFIRMED:copy.CONFIRMED, COMPLETED:copy.COMPLETED, CANCELLED:copy.CANCELLED };
    const title = labels[status];
    if (!title) return;

    const frontendUrl = String(process.env.FRONTEND_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
    const canOpenOrder = /^https:\/\//i.test(frontendUrl);
    const orderUrl = `${frontendUrl}/${locale}/account/orders/${Number(orderId)}`;
    const visibleItems = itemsResult.rows.slice(0, 20).map((item) => {
      const name = String(item.name || "").trim();
      const shortName = name.length > 70 ? `${name.slice(0, 67)}…` : name;
      return `• <b>${escapeHtml(item.article)}</b>${shortName ? ` — ${escapeHtml(shortName)}` : ""} × ${Number(item.quantity)}`;
    });
    if (itemsResult.rows.length > 20) visibleItems.push(`…${copy.more} ${itemsResult.rows.length - 20}`);
    const text = [
      title,
      `${copy.order} №${Number(orderId)}`,
      "",
      ...visibleItems,
      "",
      `${copy.total}: <b>${escapeHtml(formatMoney(orderResult.rows[0]?.total_amount))}</b>`,
    ].join("\n");

    await sendMessage(connectionResult.rows[0].telegram_chat_id, {
      text,
      ...(canOpenOrder ? {
        reply_markup: { inline_keyboard: [[{ text: copy.open, url: orderUrl }]] },
      } : {}),
    });
  },

  async sendTrackingToUser({ userId, orderId, trackingNumber }, db = pool) {
    if (process.env.NODE_ENV === "test") return { sent:false, reason:"TEST" };
    if (!process.env.TELEGRAM_BOT_TOKEN) return { sent:false, reason:"BOT_NOT_CONFIGURED" };
    if (!userId) return { sent:false, reason:"CUSTOMER_NOT_REGISTERED" };
    const result = await db.query(`SELECT telegram_chat_id, preferred_locale FROM user_telegram_connections
      WHERE user_id=$1 AND notifications_enabled=TRUE`, [userId]);
    if (!result.rows[0]) return { sent:false, reason:"CUSTOMER_NOT_CONNECTED" };
    const locale = localeOf(result.rows[0].preferred_locale);
    const text = {
      uk:`🚚 <b>Замовлення №${Number(orderId)} вже має ТТН</b>\nНова пошта: <code>${escapeHtml(trackingNumber)}</code>\n\nМожна копіювати номер і стежити за посилкою 💙`,
      en:`🚚 <b>Order №${Number(orderId)} now has a tracking number</b>\nNova Poshta: <code>${escapeHtml(trackingNumber)}</code>\n\nCopy the number to track your parcel 💙`,
      ru:`🚚 <b>У заказа №${Number(orderId)} появилась ТТН</b>\nНовая почта: <code>${escapeHtml(trackingNumber)}</code>\n\nСкопируйте номер, чтобы следить за посылкой 💙`,
    }[locale];
    await sendMessage(result.rows[0].telegram_chat_id, {
      text,
    });
    return { sent:true, reason:null };
  },

  async sendOrderUpdatedToUser({ userId, orderId }, db = pool) {
    if (process.env.NODE_ENV === "test" || !process.env.TELEGRAM_BOT_TOKEN || !userId) return;
    const [connectionResult, orderResult, itemsResult] = await Promise.all([
      db.query(`SELECT telegram_chat_id, preferred_locale FROM user_telegram_connections
        WHERE user_id=$1 AND notifications_enabled=TRUE`, [userId]),
      db.query("SELECT total_amount FROM orders WHERE id=$1", [orderId]),
      db.query(`SELECT p.article, p.name, oi.quantity, oi.price_at_purchase
        FROM order_items oi JOIN products p ON p.id=oi.product_id
        WHERE oi.order_id=$1 AND oi.status='ACTIVE' ORDER BY oi.id`, [orderId]),
    ]);
    if (!connectionResult.rows[0]) return;
    const locale = localeOf(connectionResult.rows[0].preferred_locale);
    const copy = {
      uk:{title:`✏️ <b>Замовлення №${Number(orderId)} оновлено</b>`,total:"Разом",open:"Переглянути замовлення"},
      en:{title:`✏️ <b>Order №${Number(orderId)} was updated</b>`,total:"Total",open:"View order"},
      ru:{title:`✏️ <b>Заказ №${Number(orderId)} обновлён</b>`,total:"Итого",open:"Посмотреть заказ"},
    }[locale];
    const items = itemsResult.rows.map((item) =>
      `• <b>${escapeHtml(item.article)}</b>${item.name ? ` — ${escapeHtml(item.name)}` : ""} × ${Number(item.quantity)} = <b>${escapeHtml(formatMoney(Number(item.quantity) * Number(item.price_at_purchase)))}</b>`
    );
    const message = [copy.title, "", ...items, "", `${copy.total}: <b>${escapeHtml(formatMoney(orderResult.rows[0]?.total_amount))}</b>`].join("\n");
    const frontendUrl = String(process.env.FRONTEND_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
    const orderUrl = `${frontendUrl}/${locale}/account/orders/${Number(orderId)}`;
    const canOpenOrder = /^https:\/\//i.test(frontendUrl);
    await sendMessage(connectionResult.rows[0].telegram_chat_id, {
      text:message,
      ...(canOpenOrder ? { reply_markup:{inline_keyboard:[[{text:copy.open,url:orderUrl}]]} } : {}),
    });
  },

  async sendReturnCompletedToUser({userId,orderId,items},db=pool){
    if(process.env.NODE_ENV==="test"||!process.env.TELEGRAM_BOT_TOKEN||!userId)return;
    const result=await db.query(`SELECT telegram_chat_id,preferred_locale FROM user_telegram_connections WHERE user_id=$1 AND notifications_enabled=TRUE`,[userId]);
    if(!result.rows[0])return;
    const locale=localeOf(result.rows[0].preferred_locale);
    const copy={
      uk:{title:`↩️ <b>Повернення за замовленням №${Number(orderId)} підтверджено</b>`,items:"Повернені позиції"},
      en:{title:`↩️ <b>Return for order №${Number(orderId)} confirmed</b>`,items:"Returned items"},
      ru:{title:`↩️ <b>Возврат по заказу №${Number(orderId)} подтверждён</b>`,items:"Возвращённые позиции"},
    }[locale];
    const rows=(items||[]).map((item)=>`• <b>${escapeHtml(item.article)}</b>${item.name?` — ${escapeHtml(item.name)}`:""} × ${Number(item.quantity)}`);
    await sendMessage(result.rows[0].telegram_chat_id,{text:[copy.title,"",copy.items+":",...rows].join("\n")});
  },
};
