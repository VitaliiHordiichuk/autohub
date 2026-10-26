import test from "node:test";
import assert from "node:assert/strict";
import {mergeTelegramCartItems,TelegramShoppingCartRepository} from "../repositories/TelegramShoppingCartRepository.js";
import {refreshTelegramCartItems} from "./TelegramOrderService.js";
import {telegramMainKeyboard,telegramMenuIntent,renderTelegramOrder} from "./TelegramOrderView.js";

const item=(id="A2711800109",offerId=2143,price=100,quantity=1,stock=5)=>({
  article:id,name:"Фільтр",quantity,selectedOffer:0,
  offers:[{offerId,sourceType:"OWN_STOCK",quantity:stock,price}],
});

test("Search selection only merges into existing cart on explicit add",()=>{
  const old=[item("A2711800109",2143,100,2,5)];
  const more=[item("A1673200603",2666,200,1,3)];
  assert.deepEqual(old,[item("A2711800109",2143,100,2,5)]);
  const merged=mergeTelegramCartItems(old,more);
  assert.deepEqual(merged.items.map(x=>x.article),["A2711800109","A1673200603"]);
  assert.deepEqual(merged.items.map(x=>x.quantity),[2,1]);
  assert.equal(merged.added,1);
});
test("Same offer deduplicates safely and never exceeds stock",()=>{
  const old=[item("A2711800109",2143,100,2,5)];
  const first=mergeTelegramCartItems(old,[item("A2711800109",2143,100,2,5)]);
  assert.equal(first.items[0].quantity,4);
  const second=mergeTelegramCartItems(first.items,[item("A2711800109",2143,100,2,5)]);
  assert.equal(second.items[0].quantity,5);
  assert.equal(second.items.length,1);
  const changedPrice=mergeTelegramCartItems(second.items,[item("A2711800109",2143,110,1,5)]);
  assert.equal(changedPrice.skipped,1);
  assert.equal(changedPrice.items[0].offers[0].price,100);
});
test("Two offers for one article remain separate choices",()=>{
  const out=mergeTelegramCartItems([item("A2711800109",2143,100)],
    [item("A2711800109",4444,110)]);
  assert.equal(out.items.length,2);
  assert.deepEqual(out.items.map(x=>x.offers[0].offerId),[2143,4444]);
});
test("Cart refresh detects changed price and insufficient stock",async()=>{
  const old=[item("A2711800109",2143,100,4,5)];
  const r=await refreshTelegramCartItems(old,{
    resolveItem:async article=>item(article,2143,135,0,2),
  });
  assert.equal(r.changed,true);
  assert.equal(r.items[0].quantity,2);
  assert.equal(r.items[0].offers[0].price,135);
  const again=await refreshTelegramCartItems(r.items,{
    resolveItem:async article=>item(article,2143,135,0,2),
  });
  assert.equal(again.changed,false);
});
test("Unavailable offer cannot sneak into final checkout",async()=>{
  const old=[item("A2711800109",2143,100,4,5)];
  const r=await refreshTelegramCartItems(old,{resolveItem:async()=>({
    article:"A2711800109",name:"Фільтр",offers:[],
  })});
  assert.equal(r.changed,true);
  assert.equal(r.items[0].quantity,0);
  assert.equal(r.items[0].offers.length,0);
  assert.equal(r.items[0].missingOfferId,2143);
  const button=renderTelegramOrder({stage:"CART",draft:{items:r.items},sessionKey:"aabbccdd11"});
  assert.deepEqual(button.reply_markup.inline_keyboard[0].map(b=>b.text),["🗑"]);
  const restored=await refreshTelegramCartItems(r.items,{resolveItem:async()=>item("A2711800109",2143,120,0,3)});
  assert.equal(restored.changed,true);
  assert.equal(restored.items[0].offers[0].offerId,2143);
  const updated=mergeTelegramCartItems(r.items,[item("A2711800109",2143,120,1,3)]);
  assert.equal(updated.items.length,1);
  assert.equal(updated.items[0].quantity,1);
});
test("Persisted cart is scoped to a private Telegram identity and survives searches",async()=>{
  let snapshot=[];
  const q=[];
  const db={query:async(sql,args)=>{
    q.push({sql,args});
    if(sql.startsWith("SELECT"))return {rows:[{items:snapshot}]};
    if(sql.includes("INSERT")){snapshot=JSON.parse(args[2]);return {rows:[{items:snapshot}]};}
    if(sql.startsWith("DELETE")){snapshot=[];return {rows:[]};}
    throw Error("Unexpected SQL");
  }};
  const original=[item()];
  await TelegramShoppingCartRepository.put(123,123,original,db);
  assert.deepEqual(await TelegramShoppingCartRepository.get(123,123,db),original);
  await TelegramShoppingCartRepository.clear(123,123,db);
  assert.deepEqual(await TelegramShoppingCartRepository.get(123,123,db),[]);
  assert.deepEqual(q[0].args.slice(0,2),[123,123]);
  assert.match(q[0].sql,/ON CONFLICT\(chat_id\)/);
});
test("Two-button persistent menu, distinct previews, and explicit clear confirmation",()=>{
  const menu=telegramMainKeyboard("uk");
  assert.deepEqual(menu.keyboard[0].map(b=>b.text),["🔎 Пошук","🛒 Кошик"]);
  assert.equal(menu.is_persistent,true);
  assert.equal(menu.one_time_keyboard,false);
  assert.equal(telegramMenuIntent("🛒 Кошик"),"cart");
  assert.equal(telegramMenuIntent("🔎 Пошук"),"search");
  const found=renderTelegramOrder({stage:"EDIT",draft:{items:[item()]},sessionKey:"aabbccdd11"});
  assert.match(found.text,/Результати пошуку/);
  assert.ok(found.reply_markup.inline_keyboard.flat().some(x=>x.text==="🛒 Додати вибране до кошика"));
  const quickMenu=found.reply_markup.inline_keyboard.at(-1);
  assert.deepEqual(quickMenu.map(x=>x.callback_data),
    ["mo:aabbccdd11:gosearch","mo:aabbccdd11:gocart"]);
  const cart=renderTelegramOrder({stage:"CART",draft:{items:[item()]},sessionKey:"aabbccdd11"});
  assert.match(cart.text,/Ваш кошик/);
  assert.ok(cart.reply_markup.inline_keyboard.flat().some(x=>x.text==="✅ Оформити замовлення"));
  assert.ok(cart.reply_markup.inline_keyboard.flat().some(x=>x.text==="🗑 Очистити кошик"));
  assert.deepEqual(cart.reply_markup.inline_keyboard.at(-1).map(x=>x.text),
    ["🔎 Пошук","🛒 Кошик"]);
  assert.deepEqual(cart.reply_markup.inline_keyboard[0].map(x=>x.text),["1 шт.","−","+","🗑"]);
  assert.doesNotMatch(cart.text,/№1|1\\. <b>A2711800109<\\/b>/);
  const confirm=renderTelegramOrder({stage:"CART_CLEAR_CONFIRM",draft:{items:[item()]},sessionKey:"aabbccdd11"});
  assert.match(confirm.text,/Видалити всі товари/);
  assert.deepEqual(confirm.reply_markup.inline_keyboard.map(row=>row[0].callback_data),
    ["mo:aabbccdd11:clearok","mo:aabbccdd11:clearcancel"]);
});
