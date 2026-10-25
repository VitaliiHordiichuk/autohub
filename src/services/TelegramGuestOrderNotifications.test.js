import test from "node:test";
import assert from "node:assert/strict";
import { TelegramGuestOrderRecipientRepository } from "../repositories/TelegramGuestOrderRecipientRepository.js";
import { TelegramNotificationService } from "./TelegramNotificationService.js";

test("Only explicit Telegram guest orders get a permanent recipient mapping",async()=>{
  const calls=[];
  const db={query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}};
  const count=await TelegramGuestOrderRecipientRepository.saveOrders({
    orderIds:[100,100,101],chatId:953723985,telegramUserId:953723985,
  },db);
  assert.equal(count,2);
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0].args,[100,953723985,953723985]);
  assert.match(calls[0].sql,/ON CONFLICT\(order_id\) DO NOTHING/);
  await assert.rejects(
    TelegramGuestOrderRecipientRepository.saveOrders({
      orderIds:[100],chatId:11,telegramUserId:22,
    },db),/private owned chat/);
});

test("A confirmed guest order receives Telegram status and no private account link",async()=>{
  const seen=[];
  const db={query:async(sql,args)=>{
    if(sql.includes("FROM telegram_guest_order_recipients")) {
      assert.deepEqual(args,[100]);
      return {rows:[{telegram_chat_id:953723985,preferred_locale:"uk"}]};
    }
    if(sql.includes("SELECT total_amount FROM orders"))
      return {rows:[{total_amount:1234.50}]};
    if(sql.includes("FROM order_items"))
      return {rows:[{article:"A2711800109",name:"Фільтр",quantity:1}]};
    throw Error("Unexpected query "+sql);
  }};
  await TelegramNotificationService.sendOrderStatusToUser(
    {userId:null,orderId:100,status:"CONFIRMED"},db,
    async(chatId,payload)=>seen.push({chatId,payload})
  );
  assert.equal(seen.length,1);
  assert.equal(seen[0].chatId,953723985);
  assert.match(seen[0].payload.text,/Ваше замовлення підтверджено/);
  assert.match(seen[0].payload.text,/A2711800109/);
  assert.equal(seen[0].payload.reply_markup,undefined);
});
test("Guest orders without the mapping do not notify arbitrary Telegram accounts",async()=>{
  let calls=0;
  const db={query:async(sql)=>{
    if(sql.includes("FROM telegram_guest_order_recipients"))return {rows:[]};
    if(sql.includes("SELECT total_amount FROM orders"))return {rows:[{total_amount:100}]};
    if(sql.includes("FROM order_items"))return {rows:[]};
    return {rows:[]};
  }};
  await TelegramNotificationService.sendOrderStatusToUser(
    {userId:null,orderId:101,status:"CONFIRMED"},db,async()=>{calls++;}
  );
  assert.equal(calls,0);
});
