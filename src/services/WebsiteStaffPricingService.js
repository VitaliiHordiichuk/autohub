import { pool } from "../config/db.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { CustomerPricingService } from "./CustomerPricingService.js";

// Private, server-side presentation only. The public website search does not
// call this service and can never return purchasing costs or VIP staff data.
export async function websiteStaffPrices(searchResponse, deps={}) {
  const db=deps.db||pool;
  const ids=new Set();
  for(const card of [searchResponse.productCard,...(searchResponse.family||[]),
    searchResponse.replacement?.sourceProductCard].filter(Boolean)){
    for(const offer of card.offers||[])
      if(offer.isAvailable===true&&Number(offer.quantity)>0&&Number(offer.id)>0)
        ids.add(Number(offer.id));
  }
  if(ids.size===0)return {};
  const context=await (deps.context||CustomerPricingService.getContext)(null);
  void context; // Staff price is calculated from the actual website pricing engine.
  const dbRows=(await db.query(
    "SELECT po.id,po.warehouse_id,po.minimum_sale_price,"+
    "CASE WHEN po.price_mode='MANUAL' AND po.manual_retail_price IS NOT NULL "+
    "THEN po.manual_retail_price ELSE po.retail_price END AS retail_price,"+
    "ic.unit_cost,w.name AS warehouse_name,s.name AS supplier_name "+
    "FROM product_offers po "+
    "JOIN warehouses w ON w.id=po.warehouse_id "+
    "LEFT JOIN suppliers s ON s.id=COALESCE(po.supplier_id,w.supplier_id) "+
    "LEFT JOIN product_offer_internal_costs ic ON ic.product_offer_id=po.id "+
    "WHERE po.id=ANY($1::integer[]) AND po.is_available=TRUE "+
    "AND po.is_hidden=FALSE AND po.quantity>0 AND w.is_active=TRUE "+
    "AND (s.id IS NULL OR s.is_active=TRUE)",[...ids]
  )).rows;
  const result={};
  for(const row of dbRows){
    const retail=CustomerPricingService.price({
      retailPrice:row.retail_price,minimumSalePrice:row.minimum_sale_price
    },{discountPercent:0,isVip:false});
    const vip=CustomerPricingService.price({
      retailPrice:row.retail_price,minimumSalePrice:row.minimum_sale_price
    },{discountPercent:0,isVip:true});
    const own=Number(row.warehouse_id)===1;
    result[String(row.id)]={
      warehouseName:own?"Основний склад Mercedes":
        String(row.warehouse_name||row.supplier_name||"Склад"),
      warehouseId:Number(row.warehouse_id),
      retail:own?retail?.customerPrice??null:null,
      incoming:own?row.unit_cost??null:null,
      vip:vip?.customerPrice??null
    };
  }
  return result;
}

// Return a safe, one-line text quote. The backend owns the price rule,
// so future site VIP/retail updates apply to Telegram automatically.
export async function websiteStaffClientQuote({offerId,group,userId},deps={}) {
  const id=Number(offerId),uid=Number(userId);
  if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(uid)||uid<=0||
     !["VIP","RETAIL"].includes(group))throw new Error("Invalid quote request");
  const find=deps.findOffers||ProductRepository.findOffersByProductIds;
  const db=deps.db||pool;
  const row=(await db.query(
    "SELECT po.id,po.product_id,po.warehouse_id,p.article "+
    "FROM product_offers po JOIN products p ON p.id=po.product_id "+
    "WHERE po.id=$1 LIMIT 1",[id]
  )).rows[0];
  if(!row)throw new Error("Offer unavailable");
  if(group==="RETAIL"&&Number(row.warehouse_id)!==1)
    throw new Error("Retail quote unavailable for external warehouse");
  const offer=(await find([Number(row.product_id)]))
    .find(o=>Number(o.id)===id && o.is_available===true &&
      Number(o.quantity)>0);
  if(!offer)throw new Error("Offer unavailable");
  const price=CustomerPricingService.price({
    retailPrice:offer.retail_price,minimumSalePrice:offer.minimum_sale_price
  },{discountPercent:0,isVip:group==="VIP"});
  if(!price)throw new Error("Price unavailable");
  const value=new Intl.NumberFormat("uk-UA",{
    maximumFractionDigits:2
  }).format(Number(price.customerPrice));
  const article=String(row.article||"").replace(/[\r\n\t]+/g," ").trim();
  if(!article)throw new Error("Article unavailable");
  return {text:article+" — "+value+" грн"};
}
