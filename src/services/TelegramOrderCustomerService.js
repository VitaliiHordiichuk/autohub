import { pool } from "../config/db.js";
import { normalizeOrderDelivery } from "./OrderDeliveryService.js";
import { resolveTelegramPricingIdentity } from "./TelegramCatalogService.js";

// The authenticated website generated the Telegram link. Only a unique,
// currently active CLIENT->Telegram binding can access that CLIENT's profile.
export async function getLinkedTelegramRecipient(
  {chatId,telegramUserId,expectedUserId},
  {resolveViewer=resolveTelegramPricingIdentity,db=pool}={}
) {
  if(!expectedUserId || String(chatId)!==String(telegramUserId))return null;
  const viewer=await resolveViewer({chatId,telegramUserId});
  if(!viewer?.userId || Number(viewer.userId)!==Number(expectedUserId))return null;
  const result=await db.query(`
    SELECT u.first_name,u.last_name,u.phone
    FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.id=$1 AND u.is_active=TRUE AND r.name='CLIENT'
    LIMIT 1
  `,[Number(viewer.userId)]);
  const row=result.rows[0];
  if(!row)return null;
  try {
    const contact=normalizeOrderDelivery({
      recipientFirstName:row.first_name,
      recipientLastName:row.last_name,
      recipientPhone:row.phone,
      deliveryMethod:"PICKUP",
    });
    return {firstName:contact.recipientFirstName,lastName:contact.recipientLastName,
      phone:contact.recipientPhone};
  }catch{
    // Unfilled or invalid site profile: fall back to manual input instead
    // of displaying guessed customer data or accidentally using guest data.
    return null;
  }
}

export function normalizeTelegramOrderComment(value) {
  const comment=String(value??"").trim();
  if(!comment)return null;
  if(comment.length>500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(comment)) {
    const error=new Error("INVALID_COMMENT");
    error.code="INVALID_COMMENT";
    throw error;
  }
  return comment;
}

export function telegramOrderManagerComment(comment) {
  const note=normalizeTelegramOrderComment(comment);
  return note ? "Замовлення оформлено через Telegram MAKAtron\nКоментарій клієнта: "+note
    : "Замовлення оформлено через Telegram MAKAtron";
}
