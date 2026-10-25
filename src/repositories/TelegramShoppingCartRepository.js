import { pool } from "../config/db.js";

const MAX_CART_LINES = 20;
const idOf = (item) => Number(item?.offers?.[item?.selectedOffer||0]?.offerId);
export function mergeTelegramCartItems(existing,selected){
  const next=(existing||[]).map(item=>({...item,offers:(item.offers||[]).map(o=>({...o}))}));
  let added=0,updated=0,skipped=0;
  for(const item of selected||[]){
    if(!item?.offers?.length||Number(item.quantity)<=0){skipped++;continue;}
    const offer=item.offers[item.selectedOffer||0];
    const offerId=Number(offer?.offerId);
    if(!Number.isSafeInteger(offerId)||offerId<1){skipped++;continue;}
    const index=next.findIndex(row=>idOf(row)===offerId);
    if(index<0&&next.length>=MAX_CART_LINES){skipped++;continue;}
    const limit=Math.max(0,Number(offer.quantity)||0);
    const amount=Math.max(0,Math.floor(Number(item.quantity)));
    if(index>=0){
      const old=next[index];
      // Never silently mix offers or change selected price on merge.
      const oldOffer=old.offers[old.selectedOffer||0];
      if(Math.round(Number(oldOffer.price)*100)!==Math.round(Number(offer.price)*100)){
        skipped++;continue;
      }
      const sum=Math.min(limit,Number(old.quantity||0)+amount);
      if(sum>Number(old.quantity||0)){next[index]={...old,quantity:sum};updated++;}
      else skipped++;
    } else {
      next.push({...item,quantity:Math.min(amount,limit),
        offers:[{...offer}],selectedOffer:0});
      added++;
    }
  }
  return {items:next,added,updated,skipped};
}
export const TelegramShoppingCartRepository = {
  async get(chatId,userId,db=pool){
    const {rows}=await db.query(
      "SELECT items FROM telegram_shopping_carts WHERE chat_id=$1 AND telegram_user_id=$2",
      [chatId,userId]
    );
    return Array.isArray(rows[0]?.items)?rows[0].items:[];
  },
  async put(chatId,userId,items,db=pool){
    if(!Array.isArray(items)||items.length>MAX_CART_LINES)throw Error("CART_ITEM_LIMIT");
    const {rows}=await db.query(`
      INSERT INTO telegram_shopping_carts(chat_id,telegram_user_id,items)
      VALUES($1,$2,$3::jsonb)
      ON CONFLICT(chat_id) DO UPDATE SET
        items=EXCLUDED.items,
        telegram_user_id=EXCLUDED.telegram_user_id,
        updated_at=CURRENT_TIMESTAMP
      RETURNING items
    `,[chatId,userId,JSON.stringify(items)]);
    return rows[0].items;
  },
  async clear(chatId,userId,db=pool){
    await db.query(
      "DELETE FROM telegram_shopping_carts WHERE chat_id=$1 AND telegram_user_id=$2",
      [chatId,userId]
    );
  },
};
