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
  let primaryQuote=null;
  for(let i=0;i<candidates.length;i++) {
    const product=candidates[i];
    const quote=await quoteProduct(product);
    if(i===0)primaryQuote=quote;
    if(!hasOffers(quote))continue;
    const actual=quote.article||product.article;
    return {...quote,quantity:0,selectedOffer:0,
      ...(extendedLabel(article,actual)?{requestedArticle:extendedLabel(article,actual)}:{})};
  }
  // Keep the searched number when nothing in a compatible family has stock.
  return primaryQuote?{...missing,article}:missing;
}
