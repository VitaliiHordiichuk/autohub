import test from "node:test";
import assert from "node:assert/strict";
import { resolveMakatronStaff, staffOrderKeyboard,
  sendPendingStaffOrderNotifications,formatStaffNewOrder } from "./MakatronStaffService.js";
import { searchMakatronStaffPrices,buildMakatronClientQuote } from "./MakatronStaffPricingService.js";
import { handleMakatronStaffCallback,handleMakatronStaffMessage } from "./MakatronStaffBotService.js";

function envStaff(enabled){process.env.TELEGRAM_STAFF_ENABLED=enabled?"true":"false";}

test("staff is denied unless feature explicitly enabled",async()=>{
 envStaff(false);
 let calls=0;
 assert.equal(await resolveMakatronStaff({chatId:1,telegramUserId:1},{
  query:async()=>{calls++;return {rows:[{user_id:3,role_name:"ADMIN"}]}}
 }),null);
 assert.equal(calls,0);
});
test("staff requires private user match and a single active DB role",async()=>{
 envStaff(true);
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[{user_id:4,role_name:"MANAGER",first_name:"Bob"}]}}};
 assert.equal(await resolveMakatronStaff({chatId:4,telegramUserId:5},db),null);
 assert.equal(calls,0);
 assert.deepEqual(await resolveMakatronStaff({chatId:4,telegramUserId:4},db),
 {userId:4,role:"MANAGER",firstName:"Bob"});
 assert.equal(calls,1);
 const ambiguous={query:async()=>({rows:[{user_id:4},{user_id:5}]})};
 assert.equal(await resolveMakatronStaff({chatId:4,telegramUserId:4},ambiguous),null);
});

test("new-order message escapes user data, and actions use two-step callbacks",()=>{
 const msg=formatStaffNewOrder({id:35,status:"NEW",comment:"<script>",
 company_name:"Customer <&>",total_amount:56.78,
 items:[{article:"A123",name:"<b>Brake</b>",quantity:2,price_at_purchase:10}]});
 assert.ok(msg.includes("&lt;script&gt;"));
 assert.ok(!msg.includes("<script>"));
 assert.ok(msg.includes("&lt;b&gt;Brake&lt;/b&gt;"));
 const kb=staffOrderKeyboard(35);
 assert.equal(kb.inline_keyboard[0][0].callback_data,"st:c:35");
 assert.equal(kb.inline_keyboard[0][1].callback_data,"st:x:35");
});

test("staff pricing shows six-decimal real cost and official client group prices",async()=>{
 envStaff(true);
 const offers=[{
  id:9,product_id:7,quantity:3,is_available:true,warehouse_id:1,
  warehouse_name:"MAKA",warehouse_city:"Харків",
  retail_price:200,minimum_sale_price:150
 }];
 const db={query:async(sql)=>{assert.match(sql,/product_offer_internal_costs/);
  return {rows:[{product_offer_id:9,unit_cost:"101.123456"}]}}};
 const result=await searchMakatronStaffPrices(
 {text:"A1234567890",staffUserId:5},{
  db,search:async()=>({found:true,exactProduct:{id:7,article:"A1234567890",name:"Фільтр"}}),
  findOffers:async()=>offers,
  getContext:async()=>({showAllPrices:true,priceGroups:[
   {id:3,name:"VIP",discountPercent:0,pricingMode:"MINIMUM"},
   {id:2,name:"Gold",discountPercent:10,pricingMode:"DISCOUNT"}
  ]})
 });
 assert.equal(result.length,1);
 assert.match(result[0].text,/101,123456/);
 assert.match(result[0].text,/VIP/);
 assert.match(result[0].text,/150/);
 assert.ok(result[0].reply_markup.inline_keyboard.some(row=>
  row.some(item=>item.callback_data==="st:g:9:3")));
});

test("client-ready quotation never selects or includes private unit cost",async()=>{
 const db={query:async(sql)=>{
  assert.doesNotMatch(sql,/internal_costs|unit_cost|purchase_price/i);
  return {rows:[{id:9,product_id:7,quantity:3,is_available:true,is_hidden:false,
   minimum_sale_price:150,retail_price:200,article:"A1234567890",name:"Колодки",
   warehouse_name:"MAKA",warehouse_active:true,supplier_active:true}]}},
 };
 const overrides={db,findOffers:async()=>[{id:9,product_id:7,quantity:2,retail_price:200,minimum_sale_price:150}],
 getContext:async()=>({showAllPrices:true,priceGroups:[
  {id:3,name:"VIP",discountPercent:0,pricingMode:"MINIMUM"}
 ]})};
 const result=await buildMakatronClientQuote({offerId:9,priceGroupId:3,staffUserId:5},overrides);
 assert.match(result.text,/150/);
 assert.match(result.text,/Кількість: 2/);
 assert.doesNotMatch(result.text,/Вхідна|себестоимость|закуп/i);
 await assert.rejects(buildMakatronClientQuote({offerId:9,priceGroupId:99,staffUserId:5},overrides),/Price group/);
});

test("unknown Telegram user cannot confirm orders or see staff quotes",async()=>{
 envStaff(true);
 const sent=[],api=async(method,payload)=>{sent.push({method,payload});};
 let executed=0;
 const handled=await handleMakatronStaffCallback({
  id:"cb-1",data:"st:cc:123",message:{chat:{id:42,type:"private"}},from:{id:42}
 },api,{
  resolve:async()=>null,
  confirm:async()=>{executed++;}
 });
 assert.equal(handled,true);
 assert.equal(executed,0);
 assert.equal(sent[0].method,"answerCallbackQuery");
});

test("staff cancel requires second explicit confirmation",async()=>{
 envStaff(true);
 const sent=[],api=async(method,payload)=>{sent.push({method,payload});};
 let cancelled=0;
 const overrides={
  resolve:async()=>({userId:3,role:"MANAGER"}),
  getOrder:async()=>({id:44,status:"NEW"}),
  cancel:async()=>{cancelled++;}
 };
 await handleMakatronStaffCallback({
  id:"cb-2",data:"st:x:44",message:{chat:{id:8,type:"private"}},from:{id:8}
 },api,overrides);
 assert.equal(cancelled,0);
 const prompt=sent.find(item=>item.method==="sendMessage");
 assert.equal(prompt.payload.reply_markup.inline_keyboard[0][0].callback_data,"st:xx:44");
 await handleMakatronStaffCallback({
  id:"cb-3",data:"st:xx:44",message:{chat:{id:8,type:"private"}},from:{id:8}
 },api,overrides);
 assert.equal(cancelled,1);
});

test("unlinked guests retain public bot navigation, staff menu refuses permissions",async()=>{
 envStaff(true);
 const sent=[],api=async(method,payload)=>{sent.push({method,payload});};
 const handled=await handleMakatronStaffMessage({
  text:"/staff",chat:{type:"private",id:9},from:{id:9}
 },api,{resolve:async()=>null});
 assert.equal(handled,true);
 assert.match(sent[0].payload.text,/лише після/);
 const other=await handleMakatronStaffMessage({
  text:"A123456",chat:{type:"private",id:9},from:{id:9}
 },api,{resolve:async()=>null});
 assert.equal(other,false);
});

test("notification cursor skips delivered orders and advances for new ones",async()=>{
 envStaff(true);
 const sent=[];
 const sqlCalls=[];
 let cursor=10,delivered=false;
 const db={query:async(sql,params)=>{
  sqlCalls.push(sql);
  if(sql.includes("FROM makatron_staff_links"))return {rows:[{user_id:4,telegram_chat_id:4}]};
  if(sql.includes("SELECT last_order_id"))return {rows:[{last_order_id:cursor}]};
  if(sql.includes("FROM orders WHERE id>"))return {rows:cursor===10?[{id:11,status:"NEW"}]:[]};
  if(sql.includes("SELECT 1 FROM makatron_staff_order_deliveries"))return {rows:delivered?[{exists:1}]:[]};
  if(sql.includes("INSERT INTO makatron_staff_order_deliveries")){delivered=true;return {rows:[]}};
  if(sql.includes("UPDATE makatron_staff_order_cursor")){cursor=Number(params[0]);return {rows:[]}};
  throw new Error("Unexpected SQL: "+sql);
 }};
 const api=async(method,payload)=>{sent.push({method,payload})};
 const deps={db,getOrder:async()=>({id:11,status:"NEW",total_amount:100,items:[]})};
 assert.deepEqual(await sendPendingStaffOrderNotifications(api,deps),{recipients:1,sent:1});
 assert.equal(cursor,11);
 await sendPendingStaffOrderNotifications(api,deps);
 assert.equal(sent.length,1);
});
