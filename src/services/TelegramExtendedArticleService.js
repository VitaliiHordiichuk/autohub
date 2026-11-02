import { normalizeArticle } from "./articleEngine/normalize.js";
import { isMercedesBrandName } from "./ArticleNumberService.js";

// A + ten digits is the Mercedes base; exactly two additional digits are
// SAME. Four-plus suffix digits are VARIANT and must not be auto-substituted.
function requestedMercedesBase(query) {
  const q=normalizeArticle(query);
  return /^\d{10}$/.test(q)?"A"+q:/^A\d{10}$/.test(q)?q:null;
}
function mercedesProduct(product) {
  return isMercedesBrandName(product?.brand_name??product?.manufacturer??product?.vehicle_brand);
}
function sameExtension(base,product) {
  const article=normalizeArticle(product?.article_normalized??product?.article);
  return Boolean(base && mercedesProduct(product) &&
    article.startsWith(base) && article.length===base.length+2 &&
    /^\d{2}$/.test(article.slice(base.length)));
}
function hasOffers(quote) {
  return Array.isArray(quote?.offers)&&quote.offers.some(o=>
    Number(o?.offerId)>0 && Number(o?.quantity)>0 && Number(o?.price)>0);
}
function extendedLabel(requested,actual) {
  const base=requestedMercedesBase(requested);
  const article=normalizeArticle(actual);
  return base && article.startsWith(base) && article.length>base.length
    ? String(requested).trim().slice(0,60):null;
}

// Returns exactly ONE result per query. The offer comes from the actual
// product's public quote, never from a synthetic prefix or guessed stock.
export async function resolveTelegramExtendedArticle({
  article,found,quoteProduct,maxCandidates=8,
}) {
  const missing={article,name:"",quantity:0,selectedOffer:0,offers:[]};
  if(!found?.found || typeof quoteProduct!=="function")return missing;
  const primary=found.exactProduct||found.family?.[0]||null;
  if(!primary)return missing;
  const queriedBase=requestedMercedesBase(article);
  const family=Array.isArray(found.family)?found.family:[];
  // Never substitute a variant for a full, explicitly requested article,
  // and never use this fallback for non-Mercedes numbers.
  const fallbackAllowed=Boolean(queriedBase&&
    (found.rule==="MERCEDES"||family.some(mercedesProduct)||mercedesProduct(primary)));
  const primaryArticle=normalizeArticle(primary.article_normalized??primary.article);
  const explicit=String(found.numberResolution||"").startsWith("EXPLICIT") ||
    (found.replacementPath||[]).length>0;
  const primaryIsExact=!queriedBase || primaryArticle===queriedBase ||
    primaryArticle===queriedBase.slice(1);
  // SearchService's generic prefix search can return an unrelated, long
  // Mercedes VARIANT first. NEVER sell that as a compatible base extension.
  const safePrimary=primaryIsExact||explicit||
    (fallbackAllowed&&sameExtension(queriedBase,primary));
  const candidates=safePrimary?[primary]:[];
  if(fallbackAllowed) {
    const seen=new Set(candidates.map(p=>String(p.id??p.article_normalized??p.article)));
    const relatives=family.filter(p=>sameExtension(queriedBase,p))
      .sort((a,b)=>String(a.article).localeCompare(String(b.article)));
    for(const p of relatives) {
      const k=String(p.id??p.article_normalized??p.article);
      if(seen.has(k))continue;
      seen.add(k);
      candidates.push(p);
      if(candidates.length>=Math.max(1,maxCandidates))break;
    }
  }
  // Quote the exact/base and compatible SAME alternatives (bounded to 8).
  // The selected item is the only one counted in price and checkout. Other
  // real, available product numbers are just optional alternatives.
  let preferred=null;
  const sellable=[];
  for(const product of candidates) {
    const quote=await quoteProduct(product);
    if(hasOffers(quote))sellable.push(quote);
    if(!preferred&&hasOffers(quote))preferred=quote;
  }
  if(!preferred)return missing;
  // Existing preference: first available exact article, else first stocked
  // two-digit SAME extension; never silently prefer the cheapest one.
  const other=sellable.filter(q=>normalizeArticle(q.article)!==
    normalizeArticle(preferred.article)).slice(0,3).map(q=>({
      article:q.article,name:q.name,
      offers:q.offers,selectedOffer:q.selectedOffer||0,
    }));
  const actual=preferred.article;
  return {...preferred,quantity:0,selectedOffer:0,
    ...(extendedLabel(article,actual)?{requestedArticle:extendedLabel(article,actual)}:{}),
    ...(other.length?{alternatives:other,searchArticle:String(article).trim().slice(0,60)}:{}),
  };
}

export function switchTelegramArticleAlternative(item) {
  const alternatives=Array.isArray(item?.alternatives)?item.alternatives:[];
  if(!alternatives.length)return item;
  const [other,...rest]=alternatives;
  const selected=other.offers?.[other.selectedOffer||0];
  if(!selected||Number(selected.quantity)<=0||Number(selected.price)<=0)return item;
  const previous={article:item.article,name:item.name,
    offers:item.offers,selectedOffer:item.selectedOffer||0};
  const query=item.searchArticle||item.requestedArticle||item.article;
  const article=other.article;
  return {
    ...item,article,name:other.name,offers:other.offers,
    selectedOffer:other.selectedOffer||0,
    quantity:Math.min(Math.max(1,Number(item.quantity)||1),Number(selected.quantity)),
    alternatives:[...rest,previous],
    searchArticle:query,
    requestedArticle:extendedLabel(query,article)||undefined,
  };
}
