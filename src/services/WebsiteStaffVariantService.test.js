import test from "node:test";
import assert from "node:assert/strict";
import { websiteStaffVariants } from "./WebsiteStaffVariantService.js";

test("staff gets both real Mercedes stock and supplier, even if public results hide warehouse", async () => {
  const base = {id:1, article:"A1673200603", name:"Стійка"};
  const variant = {id:2, article:"A167320060380", name:"Амортизатор"};
  const read = {
    found: true,
    searchResult: {exactProduct:base, family:[base,variant]},
    response: {locale:"uk", productCard:{product:base,offers:[
      {id:99,isAvailable:true,quantity:2}
    ]}, family:[]}
  };
  const cards = await websiteStaffVariants(read, {
    findOffers: async (ids,ctx) => {
      assert.deepEqual(ids,[1,2]);
      assert.deepEqual(ctx,{userId:null,cartId:null});
      return [
        {id:90,product_id:1,warehouse_id:1,quantity:1,
          is_available:true,is_hidden:false,warehouse_active:true,
          supplier_active:true,retail_price:null,purchase_price:200},
        {id:99,product_id:1,warehouse_id:99,quantity:2,
          is_available:true,is_hidden:false,warehouse_active:true,
          supplier_active:true,retail_price:1000},
        {id:101,product_id:2,warehouse_id:99,quantity:1,
          is_available:true,is_hidden:false,warehouse_active:true,
          supplier_active:true,retail_price:900}
      ];
    }
  });
  assert.deepEqual(cards.map(c=>c.product.article),
    ["A1673200603","A167320060380"]);
  assert.deepEqual(cards.map(c=>c.offers.map(o=>o.id)),
    [[90,99],[101]]);
  assert.equal(cards[0].offers[0].quantity,1);
  assert.equal(cards[0].offers[0].purchase_price,undefined);
  assert.equal(cards[0].offers[0].retail_price,undefined);
  assert.equal(read.response.family.length,0,
    "Must not mutate the customer-facing result");
});

test("staff excludes hidden, inactive, sold-out and reserved stock",async()=>{
  const read={found:true,searchResult:{
    exactProduct:{id:1,article:"A1673200603"},
    family:[{id:1,article:"A1673200603"},{id:2,article:"A167320060380"}]
  }};
  const rows=[
    {id:1,product_id:1,quantity:0,is_available:true},
    {id:2,product_id:1,quantity:2,is_available:false},
    {id:3,product_id:1,quantity:2,is_available:true,is_hidden:true},
    {id:4,product_id:1,quantity:2,is_available:true,warehouse_active:false},
    {id:5,product_id:1,quantity:2,is_available:true,supplier_active:false},
    {id:6,product_id:2,quantity:3,is_available:true,is_hidden:false},
  ];
  const result=await websiteStaffVariants(read,{findOffers:async()=>rows});
  assert.deepEqual(result.map(c=>c.product.article),["A167320060380"]);
  assert.deepEqual(result[0].offers.map(o=>o.id),[6]);
});

test("missing article does not query inventory",async()=>{
  const result=await websiteStaffVariants({found:false},{
    findOffers:async()=>{throw Error("Must not query");}
  });
  assert.deepEqual(result,[]);
});
