import test from "node:test";
import assert from "node:assert/strict";
import {
  readSpecialOrderPublicOffer, txtPublicSearchEnabled,
  ACTIVE_TXT_ARTICLE_SQL,
} from "./SpecialOrderPublicSearchService.js";

const row = {
  article: "A22268027293E19",
  article_normalized: "A22268027293E19",
  title: "COVER ARMREST",
  discount_group: "18",
  retail_ex_vat_uah: "62228.1500",
  import_id: "1",
};
const price = { priceGroupName: "Guest", discountPercent: 0, isVip: false };

function fakeDb(rows, calls) {
  return {async query(sql, params) {
    calls.push({sql,params});
    return {rows};
  }};
}

test("disabled by default even when a DB dependency is supplied", async () => {
  const calls=[];
  assert.equal(txtPublicSearchEnabled({}), false);
  assert.equal(txtPublicSearchEnabled({MAKA_TXT_PUBLIC_SEARCH_ENABLED:"false"}),false);
  assert.equal(txtPublicSearchEnabled({MAKA_TXT_PUBLIC_SEARCH_ENABLED:"true"}),true);
  const offer=await readSpecialOrderPublicOffer({article:row.article,pricingContext:price,enabled:false},
    {db:fakeDb([row],calls)});
  assert.equal(offer,null);
  assert.equal(calls.length,0);
});

test("reads only active READY revision and never returns a sellable stock offer",async()=>{
  const calls=[];
  const offer=await readSpecialOrderPublicOffer({
    article:"а 222-680 27 29 3E19",pricingContext:price,requestedLocale:"uk",enabled:true,
  },{db:fakeDb([row],calls)});
  assert.equal(offer.articleNormalized,row.article_normalized);
  assert.equal(offer.article,row.article);
  assert.equal(offer.availabilityStatus,"ON_REQUEST");
  assert.equal(offer.checkoutEnabled,false);
  assert.equal(offer.isAvailable,false);
  assert.equal(offer.quantity,null);
  assert.equal(offer.requiresConfirmation,true);
  assert.ok(Number.isFinite(offer.indicativePriceUah));
  assert.equal(offer.currency,"UAH");
  assert.equal(Object.hasOwn(offer,"offerId"),false);
  assert.equal(Object.hasOwn(offer,"retail_ex_vat_uah"),false);
  assert.deepEqual(calls[0].params,[row.article_normalized]);
  assert.match(ACTIVE_TXT_ARTICLE_SQL,/s\.active_import_id/);
  assert.match(ACTIVE_TXT_ARTICLE_SQL,/r\.status = 'READY'/);
  assert.match(ACTIVE_TXT_ARTICLE_SQL,/LIMIT 2/);
});

test("empty or ambiguous active results are suppressed rather than price-selected",async()=>{
  for(const rows of [[],[row,{...row,retail_ex_vat_uah:"87912.8500"}],[row,row]]){
    const offer=await readSpecialOrderPublicOffer({article:row.article,pricingContext:price,enabled:true},
      {db:fakeDb(rows,[])});
    assert.equal(offer,null);
  }
});

test("normalization and invalid W suffix are guarded",async()=>{
  const calls=[];
  const db=fakeDb([row],calls);
  for(const article of ["A22268027293E19W","W123W","","!"," "]){
    assert.equal(await readSpecialOrderPublicOffer({article,pricingContext:price,enabled:true},{db}),null);
  }
  assert.equal(calls.length,0);
});

test("invalid pricing group or source price fails closed",async()=>{
  const offer=await readSpecialOrderPublicOffer({article:row.article,pricingContext:price,enabled:true},
    {db:fakeDb([{...row,discount_group:"not-valid"}],[])});
  assert.equal(offer,null);
  const negative=await readSpecialOrderPublicOffer({article:row.article,pricingContext:price,enabled:true},
    {db:fakeDb([{...row,retail_ex_vat_uah:"-1"}],[])});
  assert.equal(negative,null);
});

test("existing pricing tiers are used, not a fabricated general discount",async()=>{
  const db=fakeDb([row],[]);
  const guest=await readSpecialOrderPublicOffer({article:row.article,pricingContext:{priceGroupName:"Guest",discountPercent:0,isVip:false},enabled:true},{db});
  const vip=await readSpecialOrderPublicOffer({article:row.article,pricingContext:{priceGroupName:"VIP",discountPercent:0,isVip:true},enabled:true},{db});
  assert.ok(vip.indicativePriceUah < guest.indicativePriceUah);
  assert.equal(guest.sourceType,"SPECIAL_ORDER");
});


test("TXT supplier tiers do not inherit MAKA registered discounts or MINIMUM mode", async () => {
  const db=fakeDb([{ ...row, retail_ex_vat_uah: "1000.0000" }], []);
  const read = (pricingContext) => readSpecialOrderPublicOffer({
    article:row.article,pricingContext,enabled:true,
  },{db});
  const guest=await read({priceGroupName:"Guest",discountPercent:0,isVip:false});
  const registered=await read({priceGroupName:"Registered",discountPercent:35,isVip:true});
  const gold=await read({priceGroupName:"GOLD",discountPercent:0,isVip:false});
  const vip=await read({priceGroupName:"vip",discountPercent:0,isVip:false});
  assert.equal(guest.indicativePriceUah,1128); // group 18 standard 6% after VAT
  assert.equal(registered.indicativePriceUah,1128); // not MAKA's 35% or MINIMUM
  assert.equal(gold.indicativePriceUah,900); // group 18 premium 25%
  assert.equal(vip.indicativePriceUah,900);
});

test("only the explicitly approved TXT supplier groups can be displayed", async () => {
  const allowed = ["00", "03", "05", "08", "09", "10", "13", "13s",
    "16", "16s", "17", "18", "20", "20s", "23", "26", "28", "30",
    "30s", "32", "35", "38", "38s", "40", "40s", "43", "46",
    "50", "52", "54", ...Array.from({length:18},(_,i)=>String(55+i))];
  for(const group of allowed) {
    const db=fakeDb([{...row,discount_group:group,retail_ex_vat_uah:"1000"}],[]);
    const result=await readSpecialOrderPublicOffer({article:row.article,
      pricingContext:{priceGroupName:"Guest"},enabled:true},{db});
    assert.ok(result,`Approved group ${group} must remain visible`);
  }
  const denied = ["01", "02", "04", "06", "07", "081", "082", "083",
    "08s", "081s", "082s", "083s", "11", "12", "54s", "55s", "73",
    "99", "100", "", "unknown", null];
  for(const group of denied) {
    const db=fakeDb([{...row,discount_group:group,retail_ex_vat_uah:"1000"}],[]);
    const result=await readSpecialOrderPublicOffer({article:row.article,
      pricingContext:{priceGroupName:"VIP"},enabled:true},{db});
    assert.equal(result,null,`Unapproved group ${group} must not be public`);
  }
});

test("supplier discount tiers are applied exactly after VAT, independently of stock", async () => {
  const cases=[
    ["00",1200,1200], ["03",1188,1140], ["08",1188,1140],
    ["10",1128,900], ["18",1128,900], ["55",1176,1116],
    ["72",1176,1116],
  ];
  for(const [group,ordinaryPrice,premiumPrice] of cases) {
    const db=fakeDb([{...row,discount_group:group,retail_ex_vat_uah:"1000.0000"}],[]);
    const ordinary=await readSpecialOrderPublicOffer({article:row.article,
      pricingContext:{priceGroupName:"CLIENT",discountPercent:90,isVip:true},
      enabled:true},{db});
    const premium=await readSpecialOrderPublicOffer({article:row.article,
      pricingContext:{priceGroupName:"GOLD",discountPercent:0,isVip:false},
      enabled:true},{db});
    assert.equal(ordinary.indicativePriceUah,ordinaryPrice,`ordinary ${group}`);
    assert.equal(premium.indicativePriceUah,premiumPrice,`GOLD ${group}`);
    assert.equal(ordinary.checkoutEnabled,false);
    assert.equal(premium.isAvailable,false);
  }
});

test("a missing or malformed customer pricing context cannot expose TXT", async () => {
  const db=fakeDb([row],[]);
  for(const ctx of [undefined,null,{}, {priceGroupName:""},
    {priceGroupName:null},{priceGroupName:3}]) {
    const offer=await readSpecialOrderPublicOffer({article:row.article,
      pricingContext:ctx,enabled:true},{db});
    assert.equal(offer,null);
  }
});
