import test from "node:test";
import assert from "node:assert/strict";
import { readWebsiteArticleSearch as readArticleSearch } from "./WebsiteArticleSearchService.js";
const readWebsiteArticleSearch=(input,deps={})=>readArticleSearch(input,{
  findPrevious:async()=>[],...deps,
});

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

function previousScenario({newExists=true,oldAvailable=true}={}) {
 const old={id:91,brand_id:1,article:'A1111111111'};
 const current={id:92,brand_id:1,article:'A2222222222'};
 const oldOffer={id:901,productId:91,sourceType:'OWN_STOCK',isAvailable:oldAvailable,quantity:oldAvailable?2:0,retailPrice:1000};
 let txtCalls=0;
 return {old,current,get txtCalls(){return txtCalls},deps:{
  search:async()=>newExists?{found:true,query:current.article,normalized:current.article,exactProduct:current,family:[current],replacementPath:[]}:{found:false,normalized:current.article},
  findPrevious:async()=>[old],pricing:async()=>({priceGroupName:'Guest'}),
  buildPrevious:async()=>[{product:old,offers:[oldOffer]}],
  buildCard:async p=>({product:p,offers:[],analogs:[],replacements:[]}),
  present:async args=>({...args,locale:'uk'}),specialOrderEnabled:true,
  specialOrder:async()=>{txtCalls++;return {article:current.article,sourceType:'SPECIAL_ORDER'}},
 }};
}
test('new-number search returns old warehouse stock ahead of a TXT price',async()=>{
 const s=previousScenario();const result=await readWebsiteArticleSearch({article:s.current.article},s.deps);
 assert.equal(result.response.productCard.product.article,s.current.article);
 assert.equal(result.response.previousNumberCards[0].product.article,s.old.article);
 assert.equal(result.response.previousNumberCards[0].offers[0].retailPrice,1000);
 assert.equal(result.response.previousNumberCards[0].offers[0].productId,s.old.id);
 assert.equal(result.response.specialOrder,undefined);assert.equal(s.txtCalls,0);
});
test('old stock is returned when the requested new number has no catalogue card',async()=>{
 const s=previousScenario({newExists:false});const result=await readWebsiteArticleSearch({article:s.current.article},s.deps);
 assert.equal(result.found,true);assert.equal(result.response.productCard,null);
 assert.equal(result.response.searchedArticle,s.current.article);
 assert.equal(result.response.rule,'PREVIOUS_NUMBER');assert.equal(s.txtCalls,0);
 assert.equal(result.response.previousNumberCards[0].product.article,s.old.article);
});
test('unavailable old numbers never suppress the requested TXT offer',async()=>{
 for(const newExists of [true,false]){
  const s=previousScenario({newExists,oldAvailable:false});const result=await readWebsiteArticleSearch({article:s.current.article},s.deps);
  assert.equal(s.txtCalls,1);assert.equal(result.response.specialOrder.article,s.current.article);
  assert.ok(!result.response.previousNumberCards?.length);
 }
});
test('site and Telegram receive identical previous stock for the same buyer',async()=>{
 const s=previousScenario();const input={article:s.current.article,userId:44,availabilityContext:{userId:44}};
 assert.deepEqual((await readWebsiteArticleSearch(input,s.deps)).response,(await readWebsiteArticleSearch(input,s.deps)).response);
});

test('a prefix hit that is a previous number is never passed off as the new product',async()=>{
 const s=previousScenario();
 const result=await readWebsiteArticleSearch({article:s.current.article},{...s.deps,
  search:async()=>({found:true,numberResolution:'PREFIX',query:s.current.article,normalized:s.current.article,exactProduct:s.old,family:[s.old]}),
 });
 assert.equal(result.found,true);assert.equal(result.response.productCard,null);
 assert.equal(result.response.previousNumberCards[0].product.article,s.old.article);
 assert.equal(result.response.rule,'PREVIOUS_NUMBER');
});
