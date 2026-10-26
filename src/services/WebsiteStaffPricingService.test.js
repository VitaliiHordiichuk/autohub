import test from "node:test";
import assert from "node:assert/strict";
import { websiteStaffPrices,websiteStaffClientQuote } from "./WebsiteStaffPricingService.js";

test("staff VIP price follows the current site VIP pricing mode, never bot constants",async()=>{
 const searchResponse={productCard:{product:{id:1},offers:[
  {id:9,isAvailable:true,quantity:1},
  {id:8,isAvailable:true,quantity:2},
 ]},family:[]};
 const db={query:async(sql,params)=>{
  if(sql.includes("FROM product_offers po")&&sql.includes("product_offer_internal_costs"))
    return {rows:[
      {id:9,warehouse_id:1,retail_price:200,minimum_sale_price:150,
        unit_cost:"100.123456",warehouse_name:"Основной склад"},
      {id:8,warehouse_id:4,retail_price:200,minimum_sale_price:150,
        unit_cost:"120",warehouse_name:"Паша"},
    ]};
  throw Error("Unexpected SQL in test "+sql);
 }};
 const data=await websiteStaffPrices(searchResponse,{
  db,vipContext:async()=>({discountPercent:10,isVip:false})
 });
 assert.equal(data["9"].vip,180,"10% VIP site discount, not minimum sale price");
 assert.equal(data["9"].retail,200);
 assert.equal(data["9"].incoming,"100.123456");
 assert.equal(data["8"].vip,180);
 assert.equal(data["8"].retail,null);
 assert.equal(data["8"].incoming,null,"supplier purchasing data not included");
});

test("staff quote uses server VIP settings and rejects supplier retail",async()=>{
 const db={query:async(sql,params)=>{
  if(sql.includes("FROM product_offers po")&&sql.includes("JOIN products p"))
    return {rows:[{id:8,product_id:5,warehouse_id:4,article:"A29668082069051"}]};
  throw Error("Unexpected SQL");
 }};
 const findOffers=async()=>[{
  id:8,is_available:true,quantity:2,retail_price:200,minimum_sale_price:150
 }];
 const vip=await websiteStaffClientQuote({
  offerId:8,group:"VIP",userId:2
 },{
  db,findOffers,vipContext:async()=>({discountPercent:10,isVip:false})
 });
 assert.equal(vip.text,"A29668082069051 — 180 грн");
 await assert.rejects(websiteStaffClientQuote({
  offerId:8,group:"RETAIL",userId:2
 },{db,findOffers}),/Retail quote unavailable for external warehouse/);
});
