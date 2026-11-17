import test from "node:test";
import assert from "node:assert/strict";
import {calculateSpecialOrderRetailPrice,calculateSpecialOrderPrice} from "./SpecialOrderPricingService.js";
import {readSpecialOrderStaffOffer} from "./SpecialOrderStaffSearchService.js";

const specialOrder={sourceType:"SPECIAL_ORDER",sourceKey:"mercedes-txt",importId:7,
 article:"A1676703800",articleNormalized:"A1676703800",checkoutEnabled:false};
const row={article:specialOrder.article,article_normalized:specialOrder.articleNormalized,
 title:"  Тяга Mercedes  ",discount_group:"18",retail_ex_vat_uah:"1000.0000",import_id:"7"};
const input={specialOrder,enabled:true};
const db=rows=>({query:async(sql,args)=>{
 assert.match(sql,/active_import_id/);assert.match(sql,/status = 'READY'/);
 assert.match(sql,/LIMIT 2/);assert.deepEqual(args,[[specialOrder.article]]);
 return {rows};
}});
test("staff retail is TXT times 1.2 with exact half-up rounding and no discount",()=>{
 for(const [value,price] of [["1000",1200],["0.0125",0.02],["62228.1500",74673.78],["1,2345",1.48]])
  assert.equal(calculateSpecialOrderRetailPrice(value),price);
 assert.equal(calculateSpecialOrderPrice({retailPriceExVatUah:"1000",secondDiscountGroup:"18",priceGroupName:"Guest"}).articlePriceUah,1128);
 assert.equal(calculateSpecialOrderPrice({retailPriceExVatUah:"1000",secondDiscountGroup:"18",priceGroupName:"VIP"}).articlePriceUah,900);
 for(const bad of [null,undefined,NaN,Infinity,0,-10,"1e3","1.00001","1 000","bad"])
  assert.equal(calculateSpecialOrderRetailPrice(bad),null);
});
test("staff quote contains the title, undiscounted VAT retail and exact supplier group",async()=>{
 const result=await readSpecialOrderStaffOffer(input,{db:db([row])});
 assert.deepEqual(result,{article:specialOrder.article,title:"Тяга Mercedes",retailPriceUah:1200,discountGroup:"18",currency:"UAH"});
 assert.equal(result.retail_ex_vat_uah,undefined);
});
test("missing titles are optional and discount group suffixes remain intact",async()=>{
 const result=await readSpecialOrderStaffOffer(input,{db:db([{...row,title:null,discount_group:" 13S "}])});
 assert.equal(result.title,null);assert.equal(result.discountGroup,"13s");
});
test("revision changes, mismatched articles, ambiguous entries and invalid prices fail closed",async()=>{
 for(const rows of [[],[row,row],[{...row,import_id:"8"}],
  [{...row,article_normalized:"OTHER"}],[{...row,article:"OTHER"}],
  [{...row,discount_group:"unknown"}],[{...row,retail_ex_vat_uah:"-1"}]])
  assert.equal(await readSpecialOrderStaffOffer(input,{db:db(rows)}),null);
});
test("disabled or invalid source metadata cannot access the TXT database",async()=>{
 const denied={query:async()=>{throw Error("No DB access expected");}};
 for(const patch of [{enabled:false},{specialOrder:null},
  {specialOrder:{...specialOrder,sourceKey:"other"}},
  {specialOrder:{...specialOrder,importId:0}},
  {specialOrder:{...specialOrder,articleNormalized:"OTHER"}},
  {specialOrder:{...specialOrder,checkoutEnabled:true}}])
  assert.equal(await readSpecialOrderStaffOffer({...input,...patch},{db:denied}),null);
});
