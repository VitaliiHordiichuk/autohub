import { pool } from "../config/db.js";
import { SearchService } from "./SearchService.js";
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
    const product=found.exactProduct || found.family?.[0];
    if(!product)continue;
    const offers=await findOffers([Number(product.id)]);
    if(!offers.length){
      results.push({text:"🔎 <code>"+escapeTelegramHtml(product.article)+"</code>\nНемає доступних залишків."});
      continue;
    }
    const ids=offers.map((offer)=>Number(offer.id));
    const costs=(await db.query(
      "SELECT product_offer_id,unit_cost FROM product_offer_internal_costs "+
      "WHERE product_offer_id=ANY($1::integer[])",[ids]
    )).rows;
    const costByOffer=new Map(costs.map((row)=>[Number(row.product_offer_id),row.unit_cost]));
    const lines=[
      "🔎 <b>"+escapeTelegramHtml(product.article)+"</b> — "+
        escapeTelegramHtml(String(product.name||"Запчастина").slice(0,130)),
    ];
    const buttons=[];
    for(const offer of offers.slice(0,4)){
      const warehouse=offer.warehouse_name||offer.supplier_name||"Склад";
      const available=Number(offer.quantity)>0 && offer.is_available===true;
      if(!available)continue;
      const vipPrice=vipGroup?CustomerPricingService.price({
        retailPrice:offer.retail_price,minimumSalePrice:offer.minimum_sale_price
      },{
        discountPercent:vipGroup.discountPercent,
        isVip:vipGroup.pricingMode==="MINIMUM"
      }):null;
      lines.push("",
        "🏬 <b>"+escapeTelegramHtml(warehouse)+"</b>"+
          (offer.warehouse_city?" · "+escapeTelegramHtml(offer.warehouse_city):""),
        "Кількість: <b>"+Number(offer.quantity)+"</b>",
        "Роздріб: <b>"+cash(offer.retail_price)+"</b>",
        "Вхідна: <b>"+cost(costByOffer.get(Number(offer.id)))+"</b>",
        "VIP: <b>"+cash(vipPrice?.customerPrice)+"</b>");
      buttons.push([{text:"📄 "+String(warehouse).slice(0,16)+" · Роздріб",
        callback_data:"st:g:"+Number(offer.id)+":0"}]);
      if(vipGroup && vipPrice){
        buttons.push([{text:"📄 "+String(warehouse).slice(0,16)+" · VIP",
          callback_data:"st:g:"+Number(offer.id)+":"+Number(vipGroup.id)}]);
      }
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
    "SELECT po.id,po.product_id,po.quantity,po.is_available,po.is_hidden,po.minimum_sale_price,"+
    "CASE WHEN po.price_mode='MANUAL' AND po.manual_retail_price IS NOT NULL "+
    "THEN po.manual_retail_price ELSE po.retail_price END AS retail_price,"+
    "p.article,p.name,w.name AS warehouse_name,w.is_active AS warehouse_active,"+
    "s.is_active AS supplier_active "+
    "FROM product_offers po JOIN products p ON p.id=po.product_id "+
    "JOIN warehouses w ON w.id=po.warehouse_id "+
    "LEFT JOIN suppliers s ON s.id=COALESCE(po.supplier_id,w.supplier_id) "+
    "WHERE po.id=$1 LIMIT 1",[id]
  )).rows[0];
  if(!data||data.is_available!==true||data.is_hidden===true||
      Number(data.quantity)<=0||data.warehouse_active!==true||
      data.supplier_active===false)throw new Error("Offer unavailable");
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
  return {
    text:"📄 <b>Пропозиція MAKA</b>\n"+
      "<code>"+escapeTelegramHtml(data.article)+"</code> — "+
      escapeTelegramHtml(String(data.name||"Запчастина").slice(0,160))+"\n"+
      "На складі: "+escapeTelegramHtml(data.warehouse_name)+"\n"+
      "Кількість: "+Number(current.quantity)+"\n"+
      "Ціна: <b>"+cash(price.customerPrice)+"</b>\n"+
      (group?"Група: VIP\n":"")+
      "\nhttps://maka.com.ua/uk/product/"+encodeURIComponent(data.article),
    parse_mode:"HTML"
  };
}
