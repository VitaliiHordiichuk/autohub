import { pool } from "../config/db.js";

export const TelegramGuestOrderRecipientRepository = {
  async saveOrders({orderIds,chatId,telegramUserId},db=pool) {
    if(!chatId || !telegramUserId || String(chatId)!==String(telegramUserId))
      throw Error("Telegram guest order recipient requires a private owned chat");
    const ids=[...new Set((orderIds||[]).map(Number))].filter(n=>Number.isSafeInteger(n)&&n>0);
    for(const orderId of ids) {
      await db.query(`
        INSERT INTO public.telegram_guest_order_recipients
          (order_id,telegram_chat_id,telegram_user_id)
        VALUES ($1,$2,$3)
        ON CONFLICT(order_id) DO NOTHING
      `,[orderId,chatId,telegramUserId]);
    }
    return ids.length;
  },
  async findByOrderId(orderId,db=pool) {
    const {rows}=await db.query(`
      SELECT telegram_chat_id
      FROM public.telegram_guest_order_recipients
      WHERE order_id=$1
    `,[orderId]);
    return rows[0]??null;
  },
};
