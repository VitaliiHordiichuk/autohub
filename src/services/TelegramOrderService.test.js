import test from "node:test";
import assert from "node:assert/strict";
import { selectTelegramOffers, editTelegramItem, parseTelegramRecipient,
  telegramInlineCheckoutEnabled } from "./TelegramOrderService.js";
import { renderTelegramOrder, deliveryKeyboard } from "./TelegramOrderView.js";

const offers=[
  {id:11,sourceType:"SUPPLIER",quantity:9,isAvailable:true,retailPrice:600},
  {id:12,sourceType:"OWN_STOCK",quantity:3,isAvailable:true,retailPrice:700},
  {id:13,sourceType:"OWN_STOCK",quantity:0,isAvailable:false,retailPrice:1},
  {id:14,sourceType:"OWN_STOCK",quantity:5,isAvailable:true,retailPrice:0},
];
test("Offer selection prefers own MAKA stock and never selects hidden or zero-priced offers",()=>{
  const selected=selectTelegramOffers(offers);
  assert.deepEqual(selected.map(x=>x.offerId),[12,11]);
  assert.equal(selected[0].quantity,3);
  assert.equal(selected[1].sourceType,"SUPPLIER");
});
test("Quantity +/- is bounded by current selected offer, zero removes from total",()=>{
  const item={article:"A2711800109",selectedOffer:0,quantity:2,offers:selectTelegramOffers(offers)};
  assert.equal(editTelegramItem(item,"p").quantity,3);
  assert.equal(editTelegramItem({...item,quantity:3},"p").quantity,3);
  assert.equal(editTelegramItem({...item,quantity:0},"m").quantity,0);
  assert.equal(editTelegramItem(item,"x").quantity,0);
  assert.equal(item.quantity,2);
});
test("Switching offers clamps requested quantity to the selected stock",()=>{
  const item={article:"HU7185X",selectedOffer:0,quantity:3,offers:[
    {offerId:5,sourceType:"SUPPLIER",quantity:5,price:200},
    {offerId:6,sourceType:"OWN_STOCK",quantity:1,price:100},
  ]};
  assert.equal(editTelegramItem(item,"s").selectedOffer,1);
  assert.equal(editTelegramItem(item,"s").quantity,1);
});
test("One and many parts share the same keyboard and totals",()=>{
  const product={article:"A2711800109",name:"Масляний фільтр",quantity:2,selectedOffer:0,
    offers:[{offerId:10,sourceType:"OWN_STOCK",quantity:3,price:750}]};
  const one=renderTelegramOrder({stage:"EDIT",draft:{items:[product]},sessionKey:"aabbccdd11"});
  assert.match(one.text,/1.500 грн/);
  assert.match(one.text,/Доступно: 3 шт/);
  assert.deepEqual(one.reply_markup.inline_keyboard[0].map(b=>b.text),
    ["A2711800109"]);
  assert.deepEqual(one.reply_markup.inline_keyboard[1].map(b=>b.text),
    ["2 шт.","−","+","🗑"]);
  assert.deepEqual(one.reply_markup.inline_keyboard.slice(0,2).flat().map(b=>b.callback_data),
    ["mo:aabbccdd11:a:0","mo:aabbccdd11:q:0","mo:aabbccdd11:m:0",
      "mo:aabbccdd11:p:0","mo:aabbccdd11:x:0"]);
  assert.doesNotMatch(one.text,/Склад MAKA|🏬/);
  const multi=renderTelegramOrder({stage:"EDIT",draft:{items:[product,product]},
    sessionKey:"aabbccdd11"});
  assert.match(multi.text,/3.000 грн/);
  assert.equal(multi.reply_markup.inline_keyboard.length,6);
  assert.match(multi.text,/Обрано: <b>2<\/b>[^]*\n\n2\. <b>A2711800109<\/b>/);
});
test("All user-provided product data is escaped and no price matrix leaks",()=>{
  const view=renderTelegramOrder({sessionKey:"aabbccdd11",stage:"EDIT",draft:{items:[{
    article:"<X&>",name:"<b>bad</b>",quantity:1,selectedOffer:0,
    priceMatrix:[{name:"STAFF",price:10}],
    offers:[{offerId:10,quantity:1,price:200,sourceType:"OWN_STOCK"}],
  }]}});
  assert.match(view.text,/&lt;X&amp;&gt;/);
  assert.doesNotMatch(view.text,/<X&>|STAFF|<b>bad<\/b>/);
});
test("English checkout and inline callback labels are localized",()=>{
  const v=renderTelegramOrder({sessionKey:"aabbccdd11",stage:"EDIT",locale:"en",
    draft:{items:[]}});
  assert.match(v.text,/Your parts list/);
  assert.match(v.text,/Total: 0 UAH/);
  assert.equal(deliveryKeyboard("aabbccdd11","en").inline_keyboard[1][0].text,"🚚 Nova Poshta");
});
test("Recipient is parsed only from explicit three semicolon-delimited fields",()=>{
  assert.deepEqual(parseTelegramRecipient("Іван; Петренко; +380501234567"),
    {firstName:"Іван",lastName:"Петренко",phone:"+380501234567"});
  assert.equal(parseTelegramRecipient("John 123"),null);
  assert.equal(parseTelegramRecipient(";;"),null);
});
test("Checkout stays disabled unless its dedicated feature flag is enabled",()=>{
  const previous=process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED;
  delete process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED;
  assert.equal(telegramInlineCheckoutEnabled(),false);
  process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED="true";
  assert.equal(telegramInlineCheckoutEnabled(),true);
  if(previous===undefined)delete process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED;
  else process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED=previous;
});

test("Optional pilot allowlist does not expose checkout to other chats",()=>{
  const oldFlag=process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED;
  const oldPilot=process.env.TELEGRAM_INLINE_CHECKOUT_TEST_CHAT_ID;
  process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED="true";
  process.env.TELEGRAM_INLINE_CHECKOUT_TEST_CHAT_ID="123456789";
  try {
    assert.equal(telegramInlineCheckoutEnabled(),false);
    assert.equal(telegramInlineCheckoutEnabled(123456789),true);
    assert.equal(telegramInlineCheckoutEnabled(2),false);
  } finally {
    if(oldFlag===undefined)delete process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED;
    else process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED=oldFlag;
    if(oldPilot===undefined)delete process.env.TELEGRAM_INLINE_CHECKOUT_TEST_CHAT_ID;
    else process.env.TELEGRAM_INLINE_CHECKOUT_TEST_CHAT_ID=oldPilot;
  }
});

test("20 positions stay within Telegram message and inline-button bounds",()=>{
  const items=Array.from({length:20},(_,i)=>({
    article:"A"+String(i).padStart(10,"0"),name:"Масляний фільтр Mercedes-Benz",
    quantity:1,selectedOffer:0,
    offers:[{offerId:i*2+1,sourceType:"OWN_STOCK",quantity:3,price:1234},
      {offerId:i*2+2,sourceType:"SUPPLIER",quantity:4,price:1111}],
  }));
  const v=renderTelegramOrder({stage:"EDIT",draft:{items},sessionKey:"aabbccdd11"});
  assert.ok(v.text.length<4096);
  assert.ok(v.reply_markup.inline_keyboard.flat().length<=100);
  assert.equal(v.reply_markup.inline_keyboard[0].length,1);
  assert.equal(v.reply_markup.inline_keyboard[1].length,4);
  assert.equal(v.reply_markup.inline_keyboard[0][0].text,items[0].article);
  assert.ok(v.reply_markup.inline_keyboard.some(row=>row.some(b=>b.callback_data.includes(":s:"))));
  assert.ok(v.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="mo:aabbccdd11:pgnext"));
  assert.ok(v.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="mo:aabbccdd11:pginfo"));
  assert.equal(v.reply_markup.inline_keyboard.filter(row=>row.length===4).length,10);
  const nextPage=renderTelegramOrder({stage:"EDIT",draft:{items,page:1},sessionKey:"aabbccdd11"});
  assert.equal(nextPage.reply_markup.inline_keyboard[0][0].text,items[10].article);
  assert.equal(nextPage.reply_markup.inline_keyboard[0][0].callback_data,"mo:aabbccdd11:s:a");
  assert.ok(nextPage.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="mo:aabbccdd11:pgprev"));
});

test("Unavailable parts have no controls but remain visible between available ones",()=>{
  const items=[
    {article:"A2711800109",name:"Масляний фільтр",quantity:1,selectedOffer:0,
      offers:[{offerId:1,sourceType:"OWN_STOCK",quantity:4,price:900}]},
    {article:"A1673200503",name:"",quantity:0,selectedOffer:0,offers:[]},
    {article:"A167320050380",name:"Стійка амортизаційна",quantity:1,selectedOffer:0,
      offers:[{offerId:2,sourceType:"OWN_STOCK",quantity:1,price:1500}]},
  ];
  const v=renderTelegramOrder({stage:"EDIT",draft:{items},sessionKey:"aabbccdd11"});
  assert.match(v.text,/Масляний фільтр[^]*\n\n2\. <code>A1673200503<\/code> — Не знайдено\n\n3\./);
  assert.equal(v.reply_markup.inline_keyboard.length,6);
  assert.equal(v.reply_markup.inline_keyboard[2][0].text,"A167320050380");
  assert.equal(v.reply_markup.inline_keyboard[2][0].callback_data,"mo:aabbccdd11:a:2");
});
test("Each part shows full-width article row above units, minus, plus and remove",()=>{
  const item={article:"A1673200603",name:"Стійка амортизаційна",quantity:1,selectedOffer:0,
    offers:[{offerId:2143,sourceType:"OWN_STOCK",quantity:2,price:104353.47}]};
  const response=renderTelegramOrder({stage:"EDIT",draft:{items:[item]},sessionKey:"fedcba9876"});
  assert.deepEqual(response.reply_markup.inline_keyboard[0].map(x=>x.text),
    ["A1673200603"]);
  assert.deepEqual(response.reply_markup.inline_keyboard[1].map(x=>x.text),
    ["1 шт.","−","+","🗑"]);
  assert.deepEqual(response.reply_markup.inline_keyboard[1].map(x=>x.callback_data),
    ["mo:fedcba9876:q:0","mo:fedcba9876:m:0",
      "mo:fedcba9876:p:0","mo:fedcba9876:x:0"]);
  assert.match(response.text,/Доступно: 2 шт/);
  assert.doesNotMatch(response.text,/Склад MAKA/);
});

test("A long Mercedes article gets the entire first keyboard row, not ellipsis",()=>{
  const article="A167320050380";
  const draft={items:[{
    article,name:"Стійка амортизаційна",quantity:1,selectedOffer:0,
    offers:[{offerId:44,sourceType:"OWN_STOCK",quantity:1,price:94638.65}]
  }]};
  const v=renderTelegramOrder({stage:"EDIT",draft,sessionKey:"aabbccdd11"});
  assert.equal(v.reply_markup.inline_keyboard[0].length,1);
  assert.equal(v.reply_markup.inline_keyboard[0][0].text,article);
  assert.equal(v.reply_markup.inline_keyboard[1].length,4);
  assert.ok(v.reply_markup.inline_keyboard.flat().every(row=>row.callback_data.length<=64));
});
