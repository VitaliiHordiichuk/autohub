import { createHash, randomBytes } from "node:crypto";
import { pool } from "../config/db.js";
import { GetManagerOrder } from "../use-cases/manager/GetManagerOrder.js";
import { escapeTelegramHtml } from "./TelegramCatalogFormatter.js";

const enabled = () => /^(1|true|on|yes)$/i.test(String(process.env.TELEGRAM_STAFF_ENABLED || ""));
const hash = (token) => createHash("sha256").update(token).digest("hex");
const isPositiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const money = (value) => new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(Number(value || 0)) + " грн";

export function staffBotEnabled() { return enabled(); }

// Both the linked account's CURRENT role and Telegram sender are checked for every request.
// A legacy customer or legacy-bot link never grants MAKAtron staff access.
export async function resolveMakatronStaff({ chatId, telegramUserId }, db = pool) {
  if (!enabled() || !isPositiveId(chatId) || String(chatId) !== String(telegramUserId)) return null;
  const result = await db.query(
    "SELECT l.user_id, r.name AS role_name, u.first_name " +
    "FROM makatron_staff_links l JOIN users u ON u.id=l.user_id " +
    "JOIN roles r ON r.id=u.role_id " +
    "WHERE l.telegram_chat_id=$1 AND l.telegram_user_id=$2 " +
    "AND u.is_active=TRUE AND r.name IN ('ADMIN','MANAGER') LIMIT 2",
    [chatId, telegramUserId]
  );
  if (result.rows.length !== 1) return null;
  return { userId: Number(result.rows[0].user_id),
    role: result.rows[0].role_name, firstName: result.rows[0].first_name || "" };
}

export async function issueMakatronStaffLink(userId, db = pool) {
  if (!isPositiveId(userId)) throw new Error("Invalid staff user ID");
  const staff = await db.query(
    "SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id " +
    "WHERE u.id=$1 AND u.is_active=TRUE AND r.name IN ('ADMIN','MANAGER')",
    [userId]
  );
  if (staff.rows.length !== 1) throw new Error("Only active ADMIN or MANAGER can link");
  const token = randomBytes(24).toString("hex");
  await db.query("DELETE FROM makatron_staff_link_tokens WHERE user_id=$1 OR expires_at<CURRENT_TIMESTAMP",[userId]);
  await db.query("INSERT INTO makatron_staff_link_tokens(user_id,token_hash,expires_at) " +
    "VALUES($1,$2,CURRENT_TIMESTAMP + INTERVAL '15 minutes')", [userId,hash(token)]);
  return "https://t.me/MAKA_com_ua_bot?start=staff_" + token;
}

export async function connectMakatronStaff({ token,chatId,telegramUserId }, db = pool) {
  if (!enabled() || !/^[a-f0-9]{48}$/i.test(String(token || ""))) return null;
  if (!isPositiveId(chatId) || String(chatId) !== String(telegramUserId)) return null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const link = await client.query(
      "SELECT t.id,t.user_id,r.name FROM makatron_staff_link_tokens t " +
      "JOIN users u ON u.id=t.user_id JOIN roles r ON r.id=u.role_id " +
      "WHERE t.token_hash=$1 AND t.used_at IS NULL " +
      "AND t.expires_at>CURRENT_TIMESTAMP AND u.is_active=TRUE " +
      "AND r.name IN ('ADMIN','MANAGER') FOR UPDATE OF t", [hash(token)]
    );
    if (link.rows.length !== 1) {
      await client.query("ROLLBACK");
      return null;
    }
    const userId = Number(link.rows[0].user_id);
    await client.query(
      "INSERT INTO makatron_staff_links(user_id,telegram_chat_id,telegram_user_id) " +
      "VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET " +
      "telegram_chat_id=EXCLUDED.telegram_chat_id,telegram_user_id=EXCLUDED.telegram_user_id," +
      "notifications_enabled=TRUE,linked_at=CURRENT_TIMESTAMP",
      [userId,chatId,telegramUserId]
    );
    await client.query("UPDATE makatron_staff_link_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=$1",[link.rows[0].id]);
    await client.query("COMMIT");
    return { userId, role: link.rows[0].name };
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally {
    client.release();
  }
}

export function staffOrderKeyboard(orderId) {
  const id = Number(orderId);
  if (!isPositiveId(id)) throw new Error("Invalid order ID");
  return { inline_keyboard: [
    [{ text: "✅ Підтвердити", callback_data: "st:c:" + id },
     { text: "❌ Скасувати", callback_data: "st:x:" + id }],
    [{ text: "📋 Відкрити в адмінці", url: "https://maka.com.ua/uk/admin/orders/" + id }]
  ] };
}

export function formatStaffNewOrder(order) {
  const items=(order.items || []).slice(0,12).map((item)=>
    "• <code>" + escapeTelegramHtml(item.article) + "</code> " +
    escapeTelegramHtml(String(item.name || "").slice(0,70)) + " × " +
    escapeTelegramHtml(item.quantity) + " — " + money(Number(item.price_at_purchase)*Number(item.quantity)));
  const delivery=order.delivery||{};
  const recipient=[delivery.recipientFirstName,delivery.recipientLastName].filter(Boolean).join(" ");
  const destination=delivery.novaPoshta?.cityName &&
    (delivery.novaPoshta?.pointName||delivery.novaPoshta?.pointAddress)
    ? delivery.novaPoshta.cityName + ", " +
      (delivery.novaPoshta.pointName||delivery.novaPoshta.pointAddress) : null;
  return [
    "🛒 <b>Нове замовлення №" + Number(order.id) + "</b>",
    "Статус: <b>" + escapeTelegramHtml(order.status) + "</b>",
    "Клієнт: " + escapeTelegramHtml(recipient||order.company_name||"Не вказано"),
    ...(delivery.recipientPhone?["Телефон: "+escapeTelegramHtml(delivery.recipientPhone)]:[]),
    ...(destination?["Доставка: "+escapeTelegramHtml(String(destination).slice(0,220))]:[]),
    ...(order.comment ? ["Коментар: " + escapeTelegramHtml(String(order.comment).slice(0,250))] : []),
    "", ...items, ...((order.items || []).length>12 ? ["…ще позицій: " + ((order.items || []).length-12)] : []),
    "", "Разом: <b>" + money(order.total_amount) + "</b>",
  ].join("\n");
}

// Dedicated MAKAtron worker sends order notifications using ITS OWN Telegram token.
// Delivery records prevent repeat messages after a worker restart. No VIN flow.
export async function sendPendingStaffOrderNotifications(api, deps = {}) {
  if (!enabled()) return { skipped: true };
  const db = deps.db || pool;
  const getOrder = deps.getOrder || GetManagerOrder.execute;
  const staff = await db.query(
    "SELECT l.user_id,l.telegram_chat_id FROM makatron_staff_links l " +
    "JOIN users u ON u.id=l.user_id JOIN roles r ON r.id=u.role_id " +
    "WHERE l.notifications_enabled=TRUE AND u.is_active=TRUE " +
    "AND r.name IN ('ADMIN','MANAGER') ORDER BY l.user_id"
  );
  if (!staff.rows.length) return { recipients: 0, sent: 0 };
  const cursor = await db.query(
    "SELECT last_order_id FROM makatron_staff_order_cursor WHERE singleton=TRUE"
  );
  if (!cursor.rows.length) throw new Error("MAKAtron staff migration 117 not installed");
  const pending = await db.query(
    "SELECT id,status FROM orders WHERE id>$1 ORDER BY id ASC LIMIT 10",
    [Number(cursor.rows[0].last_order_id)]
  );
  let sent=0;
  for(const item of pending.rows) {
    if(item.status === "NEW"){
      const order = await getOrder(item.id);
      if(order && order.status === "NEW"){
        for(const member of staff.rows) {
          const found = await db.query(
            "SELECT 1 FROM makatron_staff_order_deliveries WHERE order_id=$1 AND user_id=$2",
            [item.id,member.user_id]
          );
          if(found.rows.length) continue;
          await api("sendMessage", {
            chat_id:member.telegram_chat_id,
            parse_mode:"HTML",
            text:formatStaffNewOrder(order),
            reply_markup:staffOrderKeyboard(item.id),
          });
          await db.query(
            "INSERT INTO makatron_staff_order_deliveries(order_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [item.id,member.user_id]
          );
          sent++;
        }
      }
    }
    await db.query(
      "UPDATE makatron_staff_order_cursor SET last_order_id=GREATEST(last_order_id,$1), " +
      "updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE",[item.id]
    );
  }
  return { recipients: staff.rows.length, sent };
}
