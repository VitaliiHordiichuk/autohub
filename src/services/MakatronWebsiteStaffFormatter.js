import { CustomerPricingService } from "./CustomerPricingService.js";
import { searchWebsiteArticle,websiteSearchCards } from "./MakatronSharedSiteSearchClient.js";
import { escapeTelegramHtml } from "./TelegramCatalogFormatter.js";

const money=value=>value===null||value===undefined||!Number.isFinite(Number(value))
  ?"—":new Intl.NumberFormat("uk-UA",{maximumFractionDigits:2}).format(Number(value))+" грн";
const incoming=value=>value===null||value===undefined||!Number.isFinite(Number(value))
  ?"—":new Intl.NumberFormat("uk-UA",{
    minimumFractionDigits:2,maximumFractionDigits:6
  }).format(Number(value))+" грн";

// Presentation only; all catalogue matching and price calculations are
// provided by the running MAKA backend shared with the website.
export async function searchMakatronStaffThroughWebsite({
  parsed,staffUserId,getContext=CustomerPricingService.getContext,searchWebsite=searchWebsiteArticle
}) {
  const context=await getContext(staffUserId);
  if(context.showAllPrices!==true)throw Error("Staff pricing not permitted");
  const vip=context.priceGroups?.find(g=>
    String(g.name||"").trim().toUpperCase()==="VIP"&&Number(g.id)>0);
  const results=[];
  for(const requested of parsed.articles.slice(0,10)){
    const data=await searchWebsite({
      article:requested,locale:"uk",mode:"staff",userId:staffUserId
    });
    if(!data.success){
      results.push({text:"❌ <code>"+escapeTelegramHtml(requested)+"</code> — не знайдено"});
      continue;
    }
    if(!data.staffPrices||typeof data.staffPrices!=="object")
      throw Error("Private staff price payload missing from website backend");
    let count=0;
    for(const card of websiteSearchCards(data).slice(0,8)){
      const sellable=(card.offers||[]).filter(o=>o.isAvailable===true&&
        Number(o.quantity)>0&&data.staffPrices[String(o.id)]);
      if(!sellable.length)continue;
      count++;
      const sorted=[...sellable].sort((a,b)=>
        Number(data.staffPrices[String(b.id)].warehouseId===1)-
        Number(data.staffPrices[String(a.id)].warehouseId===1)).slice(0,4);
      const own=sorted.find(o=>data.staffPrices[String(o.id)].warehouseId===1);
      const lines=["<b>"+escapeTelegramHtml(card.product.article)+"</b> - "+
        escapeTelegramHtml(String(card.product.name||"Запчастина").slice(0,110))];
      const supplierLines=[],buttons=[];
      for(const offer of sorted){
        const p=data.staffPrices[String(offer.id)];
        const ownStock=Number(p.warehouseId)===1;
        const name=ownStock?"Основний склад Mercedes":String(p.warehouseName||"Склад");
        const safe=escapeTelegramHtml(name);
        lines.push(safe+" - "+Number(offer.quantity)+" шт");
        if(!ownStock)supplierLines.push(safe+": "+money(p.vip));
        if(ownStock)buttons.push([{
          text:"📄 "+name.slice(0,16)+" · Роздріб",
          callback_data:"st:g:"+Number(offer.id)+":0",
        }]);
        if(vip&&p.vip!==null&&p.vip!==undefined)buttons.push([{
          text:"📄 "+name.slice(0,16)+" · VIP",
          callback_data:"st:g:"+Number(offer.id)+":"+Number(vip.id),
        }]);
      }
      if(own){
        const p=data.staffPrices[String(own.id)];
        lines.push("","Роздріб: "+money(p.retail),
          "Вхідна: "+incoming(p.incoming),"VIP: "+money(p.vip));
      }
      if(supplierLines.length){
        if(!own)lines.push("");
        lines.push(...supplierLines);
      }
      results.push({text:lines.join("\n"),
        ...(buttons.length?{reply_markup:{inline_keyboard:buttons}}:{})});
    }
    if(count===0){
      results.push({text:"<code>"+escapeTelegramHtml(requested)+
        "</code> - Немає доступних залишків."});
    }
  }
  if(parsed.articles.length>10)
    results.push({text:"⚠️ Показано перші 10 артикулів."});
  return results;
}
