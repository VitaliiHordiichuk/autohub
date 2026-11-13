import test from "node:test";
import assert from "node:assert/strict";
import { readWebsiteArticleSearch } from "./WebsiteArticleSearchService.js";

test("site and Telegram share the exact same website article read model",async()=>{
 const calls=[];
 const primary={id:1,article:"A2966808206"};
 const family={id:2,article:"A29668082069051"};
 const deps={
  search:async article=>({found:true,query:article,normalized:article,
    rule:"MERCEDES",numberResolution:"DIRECT",exactProduct:primary,
    family:[primary,family],replacementPath:[]}),
  pricing:async id=>{calls.push(["pricing",id]);return {discountPercent:5};},
  buildCard:async p=>({product:p,offers:[]}),
  buildFamily:async args=>{calls.push(["family",args.exactProductId,args.requireEnabledSupplierRule]);
    return [{product:family,offers:[{id:9,isAvailable:true,quantity:1,retailPrice:100}]}];},
  present:async ({requestedLocale,productCard,family})=>({
    locale:requestedLocale,productCard,family,replacementSourceCard:null
  }),
 };
 const site=await readWebsiteArticleSearch({
  article:"A2966808206",requestedLocale:"uk",userId:null
 },deps);
 const bot=await readWebsiteArticleSearch({
  article:"A2966808206",requestedLocale:"uk",userId:null
 },deps);
 assert.deepEqual(site.response,bot.response);
 assert.equal(bot.response.family[0].product.article,"A29668082069051");
 assert.deepEqual(calls.filter(c=>c[0]==="family"),
  [["family",1,true],["family",1,true]]);
});
test("unknown site article stays unknown for Telegram, no invented variant",async()=>{
 const result=await readWebsiteArticleSearch({article:"AUNKNOWN"},{
  search:async()=>({found:false,normalized:"AUNKNOWN"})
 });
 assert.equal(result.found,false);
 assert.equal(result.response.success,false);
});

test("activated TXT fallback uses the shared site/MAKAtron response without fake product/offer",async()=>{
  const fallback={sourceType:"SPECIAL_ORDER",article:"A0001234567",
    articleNormalized:"A0001234567",indicativePriceUah:1000,
    availabilityStatus:"ON_REQUEST",checkoutEnabled:false};
  const deps={
    search:async()=>({found:false,normalized:"A0001234567",family:[]}),
    pricing:async()=>({priceGroupName:"Guest"}),
    specialOrderEnabled:true,
    specialOrder:async()=>fallback,
  };
  const input={article:"A0001234567",requestedLocale:"uk",userId:null};
  const site=await readWebsiteArticleSearch(input,deps);
  const bot=await readWebsiteArticleSearch(input,deps);
  assert.deepEqual(site.response,bot.response);
  assert.equal(site.found,true);
  assert.equal(site.response.rule,"SPECIAL_ORDER");
  assert.equal(site.response.productCard,null);
  assert.equal(site.response.specialOrder.checkoutEnabled,false);
  assert.equal(site.response.family.length,0);
});

test("TXT fallback does not run with its feature flag disabled",async()=>{
  let called=0;
  const result=await readWebsiteArticleSearch({article:"A0001234567"},{
    search:async()=>({found:false,normalized:"A0001234567"}),
    specialOrderEnabled:false,
    specialOrder:async()=>{called++;return {};},
    pricing:async()=>{called++;return {};},
  });
  assert.equal(result.found,false);
  assert.equal(called,0);
});

test("warehouse/partner offers take precedence over TXT",async()=>{
  let called=0;
  const product={id:17,article:"A0001234567"};
  const result=await readWebsiteArticleSearch({article:product.article},{
    search:async()=>({found:true,query:product.article,
      normalized:product.article,rule:"MERCEDES",
      exactProduct:product,family:[product],replacementPath:[]}),
    pricing:async()=>({priceGroupName:"VIP"}),
    buildCard:async()=>({product,offers:[{id:9,isAvailable:true}]}),
    present:async({productCard})=>({locale:"uk",productCard,family:[],replacementSourceCard:null}),
    specialOrderEnabled:true,
    specialOrder:async()=>{called++;return {};},
  });
  assert.equal(result.found,true);
  assert.equal(called,0);
  assert.equal(Object.hasOwn(result.response,"specialOrder"),false);
  assert.equal(result.response.productCard.offers[0].id,9);
});

test("existing product without any public offers can have on-request TXT metadata",async()=>{
  const product={id:21,article:"A0001234567"};
  const fallback={article:product.article,sourceType:"SPECIAL_ORDER",checkoutEnabled:false};
  const result=await readWebsiteArticleSearch({article:product.article},{
    search:async()=>({found:true,query:product.article,normalized:product.article,
      exactProduct:product,family:[product],rule:"DEFAULT",replacementPath:[]}),
    pricing:async()=>({priceGroupName:"Registered"}),
    buildCard:async()=>({product,offers:[]}),
    present:async({productCard})=>({locale:"uk",productCard,family:[],replacementSourceCard:null}),
    specialOrderEnabled:true,
    specialOrder:async()=>fallback,
  });
  assert.equal(result.response.productCard.product.id,21);
  assert.deepEqual(result.response.specialOrder,fallback);
});

test("TXT lookup failure falls back to existing not-found response",async()=>{
  const result=await readWebsiteArticleSearch({article:"A0001234567"},{
    search:async()=>({found:false,normalized:"A0001234567"}),
    pricing:async()=>({priceGroupName:"Guest"}),
    specialOrderEnabled:true,
    specialOrder:async()=>{throw new Error("test query failure");},
  });
  assert.equal(result.found,false);
  assert.equal(result.response.success,false);
});

test("existing family offers block TXT fallback even if exact card is empty",async()=>{
  const product={id:31,article:"A0001234567"};
  const result=await readWebsiteArticleSearch({article:product.article},{
    search:async()=>({found:true,query:product.article,normalized:product.article,
      exactProduct:product,family:[product,{id:32}],rule:"MERCEDES",replacementPath:[]}),
    pricing:async()=>({priceGroupName:"Guest"}),
    buildCard:async()=>({product,offers:[]}),
    buildFamily:async()=>[{product:{id:32},offers:[{id:88}]}],
    present:async({productCard,family})=>({locale:"uk",productCard,family,replacementSourceCard:null}),
    specialOrderEnabled:true,
    specialOrder:async()=>{throw new Error("TXT should not run with available family offer");},
  });
  assert.equal(result.found,true);
  assert.equal(Object.hasOwn(result.response,"specialOrder"),false);
  assert.equal(result.response.family[0].offers[0].id,88);
});
