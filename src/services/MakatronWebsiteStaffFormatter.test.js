import test from "node:test";
import assert from "node:assert/strict";
import { searchMakatronStaffThroughWebsite } from "./MakatronWebsiteStaffFormatter.js";

test("staff presentation displays own retail/incoming/VIP and supplier VIP only",async()=>{
 const product={id:1,article:"A1673200603",name:"Стійка"};
 const data={success:true,productCard:{product,offers:[
  {id:8,quantity:2,isAvailable:true},
  {id:9,quantity:1,isAvailable:true},
 ]},family:[],staffPrices:{
  "8":{warehouseId:4,warehouseName:"Паша",vip:99859.78,retail:null,incoming:null},
  "9":{warehouseId:1,warehouseName:"Основний склад Mercedes",
    vip:150000,retail:189741.3,incoming:"130921.500000"}
 }};
 const response=await searchMakatronStaffThroughWebsite({
  parsed:{articles:["A1673200603"]},staffUserId:2,
  searchWebsite:async args=>{assert.equal(args.mode,"staff");return data;},
  getContext:async()=>({showAllPrices:true,priceGroups:[
   {id:3,name:"VIP"},{id:5,name:"Gold"}
  ]})
 });
 assert.equal(response.length,1);
 assert.match(response[0].text,/Паша - 2 шт/);
 assert.match(response[0].text,/Роздріб: 189/);
 assert.match(response[0].text,/Вхідна: 130/);
 assert.match(response[0].text,/Паша: 99/);
 assert.doesNotMatch(response[0].text,/Gold|Паша.*Роздріб/);
 assert.deepEqual(response[0].reply_markup.inline_keyboard.flat().map(b=>b.callback_data),
  ["st:g:9:0","st:g:9:3","st:g:8:3"]);
});
test("no private pricing payload means fail closed",async()=>{
 await assert.rejects(searchMakatronStaffThroughWebsite({
  parsed:{articles:["A1234"]},staffUserId:2,
  searchWebsite:async()=>({success:true,productCard:{product:{id:1},offers:[]}}),
  getContext:async()=>({showAllPrices:true,priceGroups:[]})
 }),/Private staff price payload missing/);
});
