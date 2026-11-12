import { pool } from "../config/db.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildSpecialOrderStaffMessage(inquiry) {
  const id = Number(inquiry.id);
  const quantity = Number(inquiry.quantity);
  const price = Number(inquiry.estimatedUnitPriceUah);

  if (
    !Number.isSafeInteger(id) || id <= 0 ||
    !Number.isSafeInteger(quantity) || quantity < 1 ||
    !Number.isFinite(price) || price <= 0
  ) {
    throw new Error("Invalid staff notification data");
  }

  const money = new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);

  const lines = [
    `📦 <b>Нова заявка «Під замовлення» №${id}</b>`,
    "",
    `Артикул: <code>${escapeHtml(inquiry.article)}</code>`,
    `Кількість: ${quantity} шт.`,
    `Орієнтовна ціна за одиницю: <b>${money} грн</b>`,
    "",
    `Клієнт: ${escapeHtml(inquiry.contactName || "Не вказано")}`,
    `Телефон: <code>${escapeHtml(inquiry.contactPhone)}</code>`,
    `Джерело: ${inquiry.source === "MAKATRON" ? "MAKAtron" : "Сайт MAKA"}`,
    "",
    "⚠️ Наявність, остаточну ціну та строк постачання потрібно підтвердити.",
  ];

  return {
    parse_mode: "HTML",
    text: lines.join("\n"),
  };
}

async function sendTelegram(chatId, message) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();

  if (!token) throw new Error("Telegram transport unavailable");

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        ...message,
      }),
      signal: AbortSignal.timeout(8000),
    }
  );

  const result = await response.json();

  if (!response.ok || result.ok !== true) {
    throw new Error("Telegram message delivery failed");
  }
}

export async function notifySpecialOrderInquiryToStaff(
  inquiry,
  { db = pool, transport = sendTelegram } = {}
) {
  // Tests and deployments without a configured bot cannot send messages.
  if (
    transport === sendTelegram &&
    (process.env.NODE_ENV === "test" ||
     !process.env.TELEGRAM_BOT_TOKEN)
  ) {
    return {
      recipients: 0,
      sent: 0,
      failed: 0,
      skipped: true,
    };
  }

  const result = await db.query(`
    SELECT DISTINCT c.telegram_chat_id
    FROM user_telegram_connections c
    JOIN users u ON u.id = c.user_id
    JOIN employee_profiles ep ON ep.user_id = u.id
    WHERE c.notifications_enabled = TRUE
      AND c.telegram_chat_id = c.telegram_user_id
      AND u.is_active = TRUE
      AND ep.access_enabled = TRUE
      AND ep.telegram_allowed = TRUE
      AND ep.order_notifications_enabled = TRUE
      AND ep.removed_at IS NULL
      AND ep.staff_role IN ('ADMIN', 'MANAGER')
  `);

  const recipients = result.rows;
  if (!recipients.length) {
    return {
      recipients: 0,
      sent: 0,
      failed: 0,
      skipped: true,
    };
  }

  const message = buildSpecialOrderStaffMessage(inquiry);

  const deliveries = await Promise.allSettled(
    recipients.map(row =>
      transport(row.telegram_chat_id, message)
    )
  );

  const failed = deliveries.filter(
    item => item.status === "rejected"
  ).length;

  if (failed) {
    // Do not log customer contact details or Telegram credentials.
    console.error(
      "Special-order staff notification failures:",
      failed
    );
  }

  return {
    recipients: recipients.length,
    sent: recipients.length - failed,
    failed,
    skipped: false,
  };
}

// Dedicated outbox transport; existing staff notification API remains intact.
export async function sendSpecialOrderInquiryTelegram(chatId, message) {
  return sendTelegram(chatId, message);
}
