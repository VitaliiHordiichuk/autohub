// The ONLY active article/offer search source for both Telegram experiences
// after MAKAtron shared-search feature flag activation is the running MAKA
// backend, using exactly the same read model as /api/search/product.
export function siteSearchEnabled() {
  return /^(true|1|on|yes)$/i.test(String(
    process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED||"false"
  ));
}

function searchBridgeUrl(path) {
  const origin=String(process.env.MAKATRON_SEARCH_BRIDGE_URL||
    "http://127.0.0.1:4000").trim().replace(/\/+$/,"");
  // Forbid external HTTPS redirects, hosts and accidental public API use.
  const url=new URL(origin);
  if(!["127.0.0.1","localhost","::1","[::1]"].includes(url.hostname)||
     url.protocol!=="http:"||url.username||url.password||
     url.search||url.hash||url.pathname!=="/")
    throw new Error("MAKAtron search bridge must use local backend HTTP");
  return origin+path;
}

async function bridgeRequest(path,request,deps={}) {
  const secret=String(process.env.MAKATRON_SEARCH_BRIDGE_SECRET||"");
  if(Buffer.byteLength(secret)<32)throw Error("MAKAtron search bridge secret missing");
  const fetcher=deps.fetchImpl||fetch;
  const response=await fetcher(searchBridgeUrl(path),{
    method:"POST",headers:{
      "Content-Type":"application/json",
      "X-Makatron-Search-Key":secret,
    },body:JSON.stringify(request),
    signal:AbortSignal.timeout(10000),
    redirect:"error",
  });
  const data=await response.json();
  if(response.status===404&&data?.success===false)return data;
  if(!response.ok||!data||typeof data!=="object")
    throw Error("MAKAtron backend search unavailable: "+response.status);
  return data;
}

export async function searchWebsiteArticle({article,locale="uk",mode="guest",userId=null},deps={}){
  return bridgeRequest("/api/search/telegram-shared",{
    article,locale,mode,userId:mode==="guest"?null:Number(userId)
  },deps);
}

export async function quoteWebsiteOffer({offerId,group,userId},deps={}){
  return bridgeRequest("/api/search/telegram-quote",{
    offerId,group,userId:Number(userId)
  },deps);
}

// The backend controls which article variants, replacements and suppliers
// are eligible. Telegram only orders its returned cards for presentation.
export function websiteSearchCards(data) {
  if(!data?.success)return [];
  const results=[
    data.productCard,...(data.family||[]),
    data.replacement?.sourceProductCard,
    ...(data.productCard?.replacements||[]),
    ...(data.productCard?.analogs||[]),
  ];
  const seen=new Set();
  return results.filter(card=>{
    const id=Number(card?.product?.id);
    if(!Number.isSafeInteger(id)||id<=0||seen.has(id))return false;
    seen.add(id);
    return true;
  });
}

export function websiteOrderItem(data,requestedArticle,selectOffers) {
  const cards=websiteSearchCards(data);
  const rows=cards.map(card=>({
    article:String(card.product.article||"").slice(0,60),
    name:String(card.product.name||"").slice(0,90),
    quantity:0,selectedOffer:0,offers:selectOffers(card.offers),
  })).filter(row=>row.offers.length>0);
  const chosen=rows[0];
  if(!chosen)return {article:requestedArticle,name:"",quantity:0,selectedOffer:0,offers:[]};
  const alternatives=rows.slice(1,4);
  const different=String(chosen.article).toUpperCase()!==String(requestedArticle).toUpperCase();
  return {
    ...chosen,
    ...(different?{requestedArticle}:{}),
    ...(alternatives.length?{alternatives,searchArticle:requestedArticle}:{}),
  };
}
