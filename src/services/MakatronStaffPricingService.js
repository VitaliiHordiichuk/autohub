import { pool } from "../config/db.js";
import { SearchService } from "./SearchService.js";
import { resolveTelegramExtendedArticle } from "./TelegramExtendedArticleService.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { parseTelegramArticles,escapeTelegramHtml } from "./TelegramCatalogFormatter.js";

const cash = (value) => {
  if(value===null || value===undefined || Number.isNaN(Number(value)))return "—";
  return new Intl.NumberFormat("uk-UA",{maximumFractionDigits:2}).format(Number(value))+" грн";
};
const cost = (value) => value==null ? "—" :
  new Intl.NumberFormat("uk-UA",{minimumFractionDigits:2,maximumFractionDigits:6}).format(Number(value))+" грн";

// Returns private incoming prices ONLY to a caller that already passed
// resolveMakatronStaff. Do not reuse this service from a public route.
export async function searchMakatronStaffPrices({text,staffUserId},deps={}) {
  if(!Number.isSafeInteger(Number(staffUserId)) || Number(staffUserId)<=0)
    throw new Error("Required authenticated MAKA staff account");
  const db=deps.db||pool;
  const search=deps.search||SearchService.searchByArticle;
  const findOffers=deps.findOffers||ProductRepository.findOffersByProductIds;
  const resolveExtended=deps.resolveExtended||resolveTelegramExtendedArticle;
  const getContext=deps.getContext||CustomerPricingService.getContext;
  const input=String(text||"").replace(/^\/(?:price|prices|quote|ціна|цена)(?:@\w+)?\s*/i,"");
  const parsed=parseTelegramArticles(input);
  if(parsed.error) return [{text:"⚠️ Надішліть артикули, по одному у рядку (до 20)."}];
  const context=await getContext(Number(staffUserId));
  if(context.showAllPrices !== true) throw new Error("Staff pricing context not available");
  // No full price matrix: MAKAtron uses only retail and the exact VIP group.
  const vipGroup=(context.priceGroups||[]).find(group=>
    String(group.name||"").trim().toUpperCase()==="VIP" &&
    Number.isSafeInteger(Number(group.id)) && Number(group.id)>0
  );
  const results=[];
  for(const requested of parsed.articles.slice(0,10)){
    const found=await search(requested);
    if(!found?.found){
      results.push({text:"❌ <code>"+escapeTelegramHtml(requested)+"</code> — не знайдено"});
      continue;
    }
    // Reuse the customer's tested Mercedes SAME-number resolution. Only a
    // real stocked +2-digit SAME article can replace an unavailable base;
    // 4+-digit VARIANT numbers are never silently substituted.
    const offerCache=new Map();
    const resolved=await resolveExtended({
      article:requested,found,
      quoteProduct:async candidate=>{
        const id=Number(candidate?.id);
        const offers=Number.isSafeInteger(id)&&id>0
          ?await findOffers([id]):[];
        offerCache.set(id,offers);
        return {
          article:candidate.article,
          name:candidate.name,
          productId:id,
          offers:offers.filter(o=>
            o.is_available===true&&Number(o.quantity)>0&&
            Number(o.retail_price)>0
          ).map(o=>({
            offerId:Number(o.id),quantity:Number(o.quantity),
            price:Number(o.retail_price)
          }))
        };
      },
    });
    if(!resolved.offers?.length){
      results.push({text:"<code>"+escapeTelegramHtml(requested)+"</code> - Немає доступних залишків."});
      continue;
    }
    const product={article:resolved.article,name:resolved.name};
    const offers=offerCache.get(Number(resolved.productId))||[];
    const requestedArticle=resolved.requestedArticle||null;
    // Only the own Mercedes warehouse (ID 1) shows retail + incoming + VIP.
    // Suppliers show quantity and their respective VIP price only.
    const visibleOffers=offers
      .filter(offer=>Number(offer.quantity)>0 && offer.is_available===true)
      .sort((a,b)=>Number(Number(b.warehouse_id)===1)-Number(Number(a.warehouse_id)===1))
      .slice(0,4);
    if(!visibleOffers.length){
      results.push({text:escapeTelegramHtml(product.article)+" - Немає доступних залишків."});
      continue;
    }
    const mainOffer=visibleOffers.find(offer=>Number(offer.warehouse_id)===1);
    const costByOffer=new Map();
    if(mainOffer){
      const rows=(await db.query(
        "SELECT product_offer_id,unit_cost FROM product_offer_internal_costs "+
        "WHERE product_offer_id=$1",[Number(mainOffer.id)]
      )).rows;
      for(const row of rows)costByOffer.set(Number(row.product_offer_id),row.unit_cost);
    }
    const articleHeading=requestedArticle
      ?escapeTelegramHtml(requestedArticle)+" → "+escapeTelegramHtml(product.article)
      :escapeTelegramHtml(product.article);
    const lines=[
      "<b>"+articleHeading+"</b> - "+
        escapeTelegramHtml(String(product.name||"Запчастина").slice(0,130)),
    ];
    const stockLines=[];
    const supplierPriceLines=[];
    const buttons=[];
    const vipFor=offer=>vipGroup?CustomerPricingService.price({
      retailPrice:offer.retail_price,minimumSalePrice:offer.minimum_sale_price
    },{
      discountPercent:vipGroup.discountPercent,
      isVip:vipGroup.pricingMode==="MINIMUM"
    }):null;
    for(const offer of visibleOffers){
      const own=Number(offer.warehouse_id)===1;
      const warehouse=own?"Основний склад Mercedes":
        String(offer.warehouse_name||offer.supplier_name||"Склад");
      const label=escapeTelegramHtml(warehouse);
      const vipPrice=vipFor(offer);
      stockLines.push(label+" - "+Number(offer.quantity)+" шт");
      if(!own)supplierPriceLines.push(label+": "+cash(vipPrice?.customerPrice));
      // Only the own Mercedes warehouse can generate retail quotations.
      // Suppliers expose VIP only; remove the retail button entirely.
      if(own){
        buttons.push([{text:"📄 "+warehouse.slice(0,16)+" · Роздріб",
          callback_data:"st:g:"+Number(offer.id)+":0"}]);
      }
      if(vipGroup && vipPrice){
        buttons.push([{text:"📄 "+warehouse.slice(0,16)+" · VIP",
          callback_data:"st:g:"+Number(offer.id)+":"+Number(vipGroup.id)}]);
      }
    }
    lines.push(...stockLines);
    if(mainOffer){
      lines.push("",
        "Роздріб: "+cash(mainOffer.retail_price),
        "Вхідна: "+cost(costByOffer.get(Number(mainOffer.id))),
        "VIP: "+cash(vipFor(mainOffer)?.customerPrice));
    }
    if(supplierPriceLines.length){
      if(!mainOffer)lines.push("");
      lines.push(...supplierPriceLines);
    }
    results.push({
      text:lines.join("\n"),
      ...(buttons.length?{reply_markup:{inline_keyboard:buttons.slice(0,40)}}:{})
    });
  }
  if(parsed.articles.length>10){
    results.push({text:"⚠️ Показано перші 10 артикулів. Надішліть решту окремо."});
  }
  return results;
}

// Customer-ready quotes contain NO incoming cost: only retail or exact VIP.
// Stale Telegram buttons for other groups must be rejected, not merely hidden.
export async function buildMakatronClientQuote({offerId,priceGroupId=0,staffUserId},deps={}) {
  const id=Number(offerId), groupId=Number(priceGroupId);
  if(!Number.isSafeInteger(Number(staffUserId))||Number(staffUserId)<=0||
     !Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(groupId)||groupId<0)
    throw new Error("Invalid quote");
  const db=deps.db||pool;
  const getContext=deps.getContext||CustomerPricingService.getContext;
  const data=(await db.query(
    "SELECT po.id,po.product_id,po.warehouse_id,po.quantity,po.is_available,po.is_hidden,po.minimum_sale_price,"+
    "CASE WHEN po.price_mode='MANUAL' AND po.manual_retail_price IS NOT NULL "+
    "THEN po.manual_retail_price ELSE po.retail_price END AS retail_price,"+
    "p.article,w.is_active AS warehouse_active,"+
    "s.is_active AS supplier_active "+
    "FROM product_offers po JOIN products p ON p.id=po.product_id "+
    "JOIN warehouses w ON w.id=po.warehouse_id "+
    "LEFT JOIN suppliers s ON s.id=COALESCE(po.supplier_id,w.supplier_id) "+
    "WHERE po.id=$1 LIMIT 1",[id]
  )).rows[0];
  if(!data||data.is_available!==true||data.is_hidden===true||
      Number(data.quantity)<=0||data.warehouse_active!==true||
      data.supplier_active===false)throw new Error("Offer unavailable");
  // Invalidate old supplier-retail Telegram buttons, not only the new UI.
  if(groupId===0 && Number(data.warehouse_id)!==1)
    throw new Error("Retail quote unavailable for external warehouse");
  const eligible=await (deps.findOffers||ProductRepository.findOffersByProductIds)([Number(data.product_id)]);
  const current=eligible.find((offer)=>Number(offer.id)===id);
  if(!current)throw new Error("Offer no longer available");
  const context=await getContext(Number(staffUserId));
  if(context.showAllPrices!==true)throw new Error("Staff access not available");
  const group=groupId===0?null:context.priceGroups?.find(row=>
    Number(row.id)===groupId && String(row.name||"").trim().toUpperCase()==="VIP");
  if(groupId!==0&&!group)throw new Error("Only retail or VIP quotes allowed");
  const price=CustomerPricingService.price({
    retailPrice:current.retail_price,minimumSalePrice:current.minimum_sale_price
  },group?{discountPercent:group.discountPercent,isVip:group.pricingMode==="MINIMUM"}:
    {discountPercent:0,isVip:false});
  if(!price)throw new Error("Price is unavailable");
  // Copy-ready for any messenger: catalogue number and selected price only.
  // No HTML, URLs, names, warehouses, price group labels or incoming costs.
  const article=String(data.article||"").replace(/[\r\n\t]+/g," ").trim();
  if(!article)throw new Error("Article is missing");
  return { text:article+" — "+cash(price.customerPrice) };
}
