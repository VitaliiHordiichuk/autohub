import { ACTIVE_TXT_ARTICLE_SQL,txtPublicSearchEnabled } from "./SpecialOrderPublicSearchService.js";
import { specialOrderArticle } from "./SpecialOrderArticlePolicy.js";
import { calculateSpecialOrderRetailPrice,specialOrderDiscountGroup } from "./SpecialOrderPricingService.js";

// Called only after the bridge has authorized an active staff Telegram user.
// Re-read the same active revision; do not reverse a customer's discounted price.
export async function readSpecialOrderStaffOffer({specialOrder,enabled=txtPublicSearchEnabled()},deps={}) {
  if(enabled!==true || specialOrder?.sourceType!=="SPECIAL_ORDER" ||
      specialOrder.sourceKey!=="mercedes-txt" || specialOrder.checkoutEnabled!==false)
    return null;
  const valid=specialOrderArticle(specialOrder.article);
  const importId=Number(specialOrder.importId);
  if(!valid || valid.normalized!==specialOrder.articleNormalized ||
      !Number.isSafeInteger(importId)||importId<=0)return null;
  const db=deps.db||(await import("../config/db.js")).pool;
  const {rows}=await db.query(ACTIVE_TXT_ARTICLE_SQL,[[valid.normalized]]);
  if(!Array.isArray(rows)||rows.length!==1)return null;
  const row=rows[0];
  if(row.article_normalized!==valid.normalized ||
      specialOrderArticle(row.article)?.normalized!==valid.normalized ||
      Number(row.import_id)!==importId)return null;
  const discountGroup=specialOrderDiscountGroup(row.discount_group);
  const retailPriceUah=calculateSpecialOrderRetailPrice(row.retail_ex_vat_uah);
  if(!discountGroup||!retailPriceUah)return null;
  const title=typeof row.title==="string"?row.title.trim().slice(0,250):null;
  return {article:String(row.article),title:title||null,retailPriceUah,discountGroup,currency:"UAH"};
}
