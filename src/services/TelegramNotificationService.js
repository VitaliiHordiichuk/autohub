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
  async sendNewOrder({ orderId, customerName, totalAmount, itemsCount }, db = pool) {
    if (process.env.NODE_ENV === "test" || !process.env.TELEGRAM_BOT_TOKEN) return;
    const result = await db.query(`
      SELECT c.telegram_chat_id
      FROM user_telegram_connections c
      JOIN users u ON u.id = c.user_id
      JOIN roles r ON r.id = u.role_id
      WHERE c.notifications_enabled = TRUE AND u.is_active = TRUE
        AND r.name IN ('ADMIN', 'MANAGER')`);
    if (!result.rows.length) return;

    const frontendUrl = String(process.env.FRONTEND_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
    const orderUrl = `${frontendUrl}/uk/admin/orders/${Number(orderId)}`;
    const text = [
      `🛒 <b>Нове замовлення №${Number(orderId)}</b>`,
      `Клієнт: ${escapeHtml(customerName || "Не вказано")}`,
      `Позицій: ${Number(itemsCount || 0)}`,
      `Сума: <b>${escapeHtml(formatMoney(totalAmount))}</b>`,
    ].join("\n");

    const deliveries = await Promise.allSettled(result.rows.map((row) =>
      sendMessage(row.telegram_chat_id, {
        text,
        reply_markup: { inline_keyboard: [[{ text: "Відкрити замовлення", url: orderUrl }]] },
      })
    ));
    deliveries.forEach((delivery) => {
      if (delivery.status === "rejected") console.error("Не удалось отправить Telegram-уведомление:", delivery.reason?.message || delivery.reason);
    });
  },
};
