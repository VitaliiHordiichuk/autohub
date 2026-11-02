import { pool } from "../config/db.js";
import { TelegramLanguageService } from "./TelegramLanguageService.js";
import { money } from "./TelegramOrderView.js";

export async function sendPendingTelegramGuestOrderConfirmations(api,{
  db=pool,getLocale=TelegramLanguageService.get,
  pilotChatId=process.env.TELEGRAM_INLINE_CHECKOUT_TEST_CHAT_ID||null,
}={}) {
  const onlyChat=pilotChatId===null?null:String(pilotChatId).trim();
  if(onlyChat && !/^\d{1,19}$/.test(onlyChat))throw Error("Invalid guest confirmation pilot chat ID");
  // Short lease prevents two worker processes from claiming the same order.
  // An interruption after a claim retries after the lease expires.
  const {rows}=await db.query(`
    WITH pending AS (
      SELECT g.order_id
      FROM telegram_guest_order_recipients g
      JOIN orders o ON o.id=g.order_id
      WHERE o.status='CONFIRMED'
        -- Registered account orders (created_by present) are notified by
        -- the existing website backend, so the bot must not send twice.
        AND o.created_by IS NULL
        AND g.confirmed_notified_at IS NULL
        AND (g.confirmed_claimed_until IS NULL
          OR g.confirmed_claimed_until<CURRENT_TIMESTAMP)
        AND ($1::bigint IS NULL OR g.telegram_chat_id=$1::bigint)
      ORDER BY g.created_at,g.order_id
      LIMIT 5 FOR UPDATE OF g SKIP LOCKED
    )
    UPDATE telegram_guest_order_recipients g
      SET confirmed_claimed_until=CURRENT_TIMESTAMP + INTERVAL '2 minutes'
    FROM pending p,orders o
    WHERE g.order_id=p.order_id AND o.id=g.order_id
    RETURNING g.order_id,g.telegram_chat_id,o.total_amount
  `,[onlyChat]);
  let sent=0,failed=0;
  for(const row of rows) {
    const orderId=Number(row.order_id);
    try {
      const locale=await getLocale(row.telegram_chat_id);
      const english=locale==="en";
      const msg=[
        english?"✅ <b>Your order has been confirmed!</b>":
          "✅ <b>Ваше замовлення підтверджено!</b>",
        (english?"Order":"Замовлення")+" №"+orderId,
        (english?"Total":"Сума")+": "+money(row.total_amount,locale),
        "",
        english?"Your manager has confirmed the order.":
          "Менеджер підтвердив ваше замовлення.",
      ].join("\n");
      await api("sendMessage",{chat_id:row.telegram_chat_id,text:msg,parse_mode:"HTML"});
      await db.query(`
        UPDATE telegram_guest_order_recipients
        SET confirmed_notified_at=CURRENT_TIMESTAMP,
            confirmed_claimed_until=NULL
        WHERE order_id=$1 AND confirmed_notified_at IS NULL
      `,[orderId]);
      sent++;
    }catch(error){
      failed++;
      console.error("MAKAtron guest order confirmation:",error.message);
      await db.query(`
        UPDATE telegram_guest_order_recipients
        SET confirmed_claimed_until=NULL
        WHERE order_id=$1 AND confirmed_notified_at IS NULL
      `,[orderId]).catch(()=>{});
    }
  }
  return {claimed:rows.length,sent,failed};
}
