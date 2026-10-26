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
    for(const offer of offers.slice(0,8)){
      const warehouse=offer.warehouse_name||offer.supplier_name||"Склад";
      const available=Number(offer.quantity)>0 && offer.is_available===true;
      if(!available)continue;
      lines.push("",
        "🏬 <b>"+escapeTelegramHtml(warehouse)+"</b>"+
         (offer.warehouse_city?" · "+escapeTelegramHtml(offer.warehouse_city):""),
        "Кількість: <b>"+Number(offer.quantity)+"</b>"+
         " · Роздріб: <b>"+cash(offer.retail_price)+"</b>",
        "Вхідна: <b>"+cost(costByOffer.get(Number(offer.id)))+"</b>");
      const matrix=CustomerPricingService.priceMatrix({
        retailPrice:offer.retail_price,minimumSalePrice:offer.minimum_sale_price
      },context)||[];
      for(const price of matrix.slice(0,10)){
        lines.push("• "+escapeTelegramHtml(price.name)+": <b>"+cash(price.price)+"</b>");
      }
      buttons.push([{text:"📄 Клієнту · "+String(warehouse).slice(0,22),
        callback_data:"st:g:"+Number(offer.id)+":0"}]);
    }
    results.push({
      text:lines.join("\n").slice(0,3850),
      ...(buttons.length?{reply_markup:{inline_keyboard:buttons.slice(0,8)}}:{})
    });
  }
  if(parsed.articles.length>10){
    results.push({text:"⚠️ Показано перші 10 артикулів. Надішліть решту окремо."});
  }
  return results;
}

// Safe client-ready quote contains NO unit cost and NO wholesale matrix.
// The chosen pricing group is looked up afresh in the MAKA price engine.
export async function buildMakatronClientQuote({offerId,priceGroupId=0,staffUserId},deps={}) {
  const id=Number(offerId), groupId=Number(priceGroupId);
  if(!Number.isSafeInteger(Number(staffUserId))||Number(staffUserId)<=0||
     !Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(groupId)||groupId<0)
    throw new Error("Invalid quote");
  const db=deps.db||pool;
  const getContext=deps.getContext||CustomerPricingService.getContext;
  const data=(await db.query(
    "SELECT po.id,po.quantity,po.is_available,po.is_hidden,po.minimum_sale_price,"+
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
  const context=await getContext(Number(staffUserId));
  if(context.showAllPrices!==true)throw new Error("Staff access not available");
  const group=groupId===0?null:context.priceGroups?.find((row)=>row.id===groupId);
  if(groupId!==0&&!group)throw new Error("Price group not found");
  const price=CustomerPricingService.price({
    retailPrice:data.retail_price,minimumSalePrice:data.minimum_sale_price
  },group?{discountPercent:group.discountPercent,isVip:group.pricingMode==="MINIMUM"}:
    {discountPercent:0,isVip:false});
  if(!price)throw new Error("Price is unavailable");
  return {
    text:"📄 <b>Пропозиція MAKA</b>\n"+
      "<code>"+escapeTelegramHtml(data.article)+"</code> — "+
      escapeTelegramHtml(String(data.name||"Запчастина").slice(0,160))+"\n"+
      "На складі: "+escapeTelegramHtml(data.warehouse_name)+"\n"+
      "Кількість: "+Number(data.quantity)+"\n"+
      "Ціна: <b>"+cash(price.customerPrice)+"</b>\n"+
      (group?"Група: "+escapeTelegramHtml(group.name)+"\n":"")+
      "\nhttps://maka.com.ua/uk/product/"+encodeURIComponent(data.article),
    parse_mode:"HTML"
  };
}
