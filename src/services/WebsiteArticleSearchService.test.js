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
