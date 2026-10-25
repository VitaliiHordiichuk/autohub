import test from "node:test";
import assert from "node:assert/strict";
import { TelegramGuestOrderRecipientRepository } from "../repositories/TelegramGuestOrderRecipientRepository.js";
import { sendPendingTelegramGuestOrderConfirmations } from "./TelegramGuestOrderNotificationService.js";

test("Only actual Telegram guest orders persist an authorized private chat",async()=>{
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

test("Manager-confirmed guest order is sent once and marked notified",async()=>{
  const calls=[],sent=[];
  const db={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes("WITH pending"))return {rows:[
      {order_id:100,telegram_chat_id:953723985,total_amount:1234.5},
    ]};
    return {rows:[]};
  }};
  const result=await sendPendingTelegramGuestOrderConfirmations(
    async(method,payload)=>sent.push({method,payload}),
    {db,getLocale:async()=> "uk",pilotChatId:"953723985"}
  );
  assert.deepEqual(result,{claimed:1,sent:1,failed:0});
  assert.deepEqual(calls[0].args,["953723985"]);
  assert.match(calls[0].sql,/o.status='CONFIRMED'/);
  assert.match(calls[0].sql,/confirmed_notified_at IS NULL/);
  assert.match(calls[0].sql,/SKIP LOCKED/);
  assert.match(sent[0].payload.text,/Ваше замовлення підтверджено/);
  assert.match(sent[0].payload.text,/Замовлення №100/);
  assert.equal(sent[0].payload.chat_id,953723985);
  assert.ok(calls.some(x=>/SET confirmed_notified_at=CURRENT_TIMESTAMP/.test(x.sql)));
});

test("Failed Telegram delivery releases claim for retry without marking sent",async()=>{
  const calls=[];
  const db={query:async(sql,args)=>{
    calls.push(sql);
    if(sql.includes("WITH pending"))return {rows:[
      {order_id:101,telegram_chat_id:953723985,total_amount:30},
    ]};
    return {rows:[]};
  }};
  const oldConsole=console.error;
  console.error=()=>{};
  try{
    const result=await sendPendingTelegramGuestOrderConfirmations(
      async()=>{throw Error("Temporary Telegram error");},
      {db,getLocale:async()=> "en",pilotChatId:"953723985"}
    );
    assert.deepEqual(result,{claimed:1,sent:0,failed:1});
    assert.ok(calls.some(x=>/SET confirmed_claimed_until=NULL/.test(x)));
    assert.equal(calls.some(x=>/SET confirmed_notified_at=CURRENT_TIMESTAMP/.test(x)),false);
  }finally{console.error=oldConsole;}
});

test("A pilot does not query or notify guest orders from other chats",async()=>{
  const seen=[];
  const db={query:async(sql,args)=>{
    assert.equal(args[0],"953723985");
    return {rows:[]};
  }};
  assert.deepEqual(await sendPendingTelegramGuestOrderConfirmations(
    async()=>seen.push(true),{db,getLocale:async()=>"uk",pilotChatId:"953723985"}
  ),{claimed:0,sent:0,failed:0});
  assert.deepEqual(seen,[]);
});
