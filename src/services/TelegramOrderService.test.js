import test from "node:test";
import assert from "node:assert/strict";
import { selectTelegramOffers, editTelegramItem, parseTelegramRecipient,
  telegramInlineCheckoutEnabled, pickupSelection, sanitizeLegacyTelegramPickup,
  articlesStartingFreshTelegramSearch } from "./TelegramOrderService.js";
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
    ["2 шт.","−","+","🗑"]);
  assert.deepEqual(one.reply_markup.inline_keyboard[0].map(b=>b.callback_data),
    ["mo:aabbccdd11:q:0","mo:aabbccdd11:m:0",
      "mo:aabbccdd11:p:0","mo:aabbccdd11:x:0"]);
  assert.match(one.text,/href="https:\/\/maka\.com\.ua\/uk\/product\/A2711800109">A2711800109<\/a>/);
  assert.doesNotMatch(one.text,/1\. <a href=/);
  assert.deepEqual(one.reply_markup.inline_keyboard[1].map(b=>b.text),
    ["🔗 Переглянути на MAKA"]);
  assert.equal(one.reply_markup.inline_keyboard[1][0].url,
    "https://maka.com.ua/uk/product/A2711800109");
  assert.doesNotMatch(one.text,/Склад MAKA|🏬/);
  const multi=renderTelegramOrder({stage:"EDIT",draft:{items:[product,product]},
    sessionKey:"aabbccdd11"});
  assert.match(multi.text,/3.000 грн/);
  assert.equal(multi.reply_markup.inline_keyboard.length,5);
  assert.match(multi.text,/Обрано: <b>2<\/b>[^]*\n\n2\. <a href="https:\/\/maka\.com\.ua\/uk\/product\/A2711800109">A2711800109<\/a>/);
  assert.equal(multi.reply_markup.inline_keyboard.flat().filter(b=>b.url).length,0);
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
  assert.match(v.text,/Search results/);
  assert.match(v.text,/Total: 0 UAH/);
  assert.equal(deliveryKeyboard("aabbccdd11","en").inline_keyboard[1][0].text,"🚚 Nova Poshta");
});
test("Recipient accepts both normal space-separated contact and legacy semicolons",()=>{
  const expected={firstName:"Іван",lastName:"Петренко",phone:"+380501234567"};
  assert.deepEqual(parseTelegramRecipient("Іван; Петренко; +380501234567"),expected);
  assert.deepEqual(parseTelegramRecipient("Іван Петренко +380501234567"),expected);
  assert.deepEqual(parseTelegramRecipient(" Іван  Петренко   +380501234567  "),expected);
  assert.deepEqual(parseTelegramRecipient("Ivan Petrenko +380501234567"),
    {firstName:"Ivan",lastName:"Petrenko",phone:"+380501234567"});
  assert.equal(parseTelegramRecipient("John 123"),null);
  assert.equal(parseTelegramRecipient(";;"),null);
  assert.equal(parseTelegramRecipient("Іван +380501234567"),null);
  assert.equal(parseTelegramRecipient("Іван Петренко notaphone"),null);
  assert.equal(parseTelegramRecipient("Іван Петренко +380501234567; extra"),null);
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
  assert.equal(v.reply_markup.inline_keyboard[0].length,5);
  assert.equal(v.reply_markup.inline_keyboard[0][0].text,"№1");
  assert.ok(v.reply_markup.inline_keyboard.some(row=>row.some(b=>b.callback_data.includes(":s:"))));
  assert.ok(v.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="mo:aabbccdd11:pgnext"));
  assert.ok(v.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="mo:aabbccdd11:pginfo"));
  assert.equal(v.reply_markup.inline_keyboard.filter(row=>row.length===5).length,10);
  const nextPage=renderTelegramOrder({stage:"EDIT",draft:{items,page:1},sessionKey:"aabbccdd11"});
  assert.equal(nextPage.reply_markup.inline_keyboard[0][0].text,"№11");
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
  assert.equal(v.reply_markup.inline_keyboard.length,5);
  assert.equal(v.reply_markup.inline_keyboard[1][0].text,"№3");
  assert.equal(v.reply_markup.inline_keyboard[1][0].callback_data,"mo:aabbccdd11:a:2");
});
test("Single search result uses one row with quantity, minus, plus and remove",()=>{
  const item={article:"A1673200603",name:"Стійка амортизаційна",quantity:1,selectedOffer:0,
    offers:[{offerId:2143,sourceType:"OWN_STOCK",quantity:2,price:104353.47}]};
  const response=renderTelegramOrder({stage:"EDIT",draft:{items:[item]},sessionKey:"fedcba9876"});
  assert.deepEqual(response.reply_markup.inline_keyboard[0].map(x=>x.text),
    ["1 шт.","−","+","🗑"]);
  assert.deepEqual(response.reply_markup.inline_keyboard[0].map(x=>x.callback_data),
    ["mo:fedcba9876:q:0","mo:fedcba9876:m:0",
      "mo:fedcba9876:p:0","mo:fedcba9876:x:0"]);
  assert.match(response.text,/Доступно: 2 шт/);
  assert.doesNotMatch(response.text,/Склад MAKA/);
});

test("Long Mercedes article stays in full quote without №1 for one result",()=>{
  const article="A167320050380";
  const draft={items:[{
    article,name:"Стійка амортизаційна",quantity:1,selectedOffer:0,
    offers:[{offerId:44,sourceType:"OWN_STOCK",quantity:1,price:94638.65}]
  }]};
  const v=renderTelegramOrder({stage:"EDIT",draft,sessionKey:"aabbccdd11"});
  assert.equal(v.reply_markup.inline_keyboard[0].length,4);
  assert.equal(v.reply_markup.inline_keyboard[0][0].text,"1 шт.");
  assert.match(v.text,/href="https:\/\/maka\.com\.ua\/uk\/product\/A167320050380">A167320050380<\/a>/);
  assert.doesNotMatch(v.text,/1\. <a href=/);
  assert.ok(v.reply_markup.inline_keyboard.flat().every(row=>row.callback_data.length<=64));
});
test("Generic self-pickup needs no warehouse, address or internal selection",()=>{
  assert.deepEqual(pickupSelection("uk"),{method:"PICKUP",label:"Самовивіз"});
  assert.deepEqual(pickupSelection("en"),{method:"PICKUP",label:"Collection"});
  const d=pickupSelection("uk");
  assert.equal(Object.hasOwn(d,"warehouseId"),false);
});
test("Old internal warehouse draft is sanitized before it can be shown again",()=>{
  const row={stage:"REVIEW",draft:{delivery:{method:"PICKUP",warehouseId:21,label:"Харків · Паша"},
    deliveryInput:{deliveryMethod:"PICKUP",pickupWarehouseId:21,recipientPhone:"+380501234567"},
    options:[{name:"Наш склад Renault"}]}};
  assert.equal(sanitizeLegacyTelegramPickup(row),true);
  assert.deepEqual(row.draft.delivery,pickupSelection("uk"));
  assert.equal(row.draft.deliveryInput.pickupWarehouseId,null);
  assert.equal(row.draft.options,undefined);
  const review=renderTelegramOrder({stage:row.stage,draft:row.draft,sessionKey:"aabbccdd11"});
  assert.match(review.text,/Самовивіз/);
  assert.doesNotMatch(review.text,/Паша|Renault|Mercedes|склад/);
});
test("Old PICKUP stage resets to method selection instead of exposing old warehouse list",()=>{
  const row={stage:"PICKUP",draft:{options:[{name:"Основний склад Mercedes"}]}};
  assert.equal(sanitizeLegacyTelegramPickup(row),true);
  assert.equal(row.stage,"DELIVERY");
  assert.deepEqual(row.draft.options,[]);
});
test("Thank-you message appears only after a committed order, with no address",()=>{
  const done=renderTelegramOrder({stage:"DONE",draft:{orderIds:[12345]},sessionKey:"aabbccdd11"});
  assert.match(done.text,/Дякуємо за замовлення!/);
  assert.match(done.text,/Менеджер зв’яжеться з вами/);
  assert.match(done.text,/12345/);
  assert.doesNotMatch(done.text,/адрес|склад|Паша/i);
  const review=renderTelegramOrder({stage:"REVIEW",draft:{items:[]},sessionKey:"aabbccdd11"});
  assert.doesNotMatch(review.text,/Дякуємо за замовлення!/);
});

test("The contact prompt explains natural whitespace format to Ukrainian and English customers",()=>{
  const uk=renderTelegramOrder({stage:"CONTACT_INPUT",draft:{},
    locale:"uk",sessionKey:"aabbccdd11"});
  const en=renderTelegramOrder({stage:"CONTACT_INPUT",draft:{},
    locale:"en",sessionKey:"aabbccdd11"});
  assert.match(uk.text,/Ім’я Прізвище \+380XXXXXXXXX/);
  assert.match(en.text,/First Last \+380XXXXXXXXX/);
  assert.doesNotMatch(uk.text,/;/);
});

test("Part number typed on an old contact screen starts a completely new search",()=>{
  for(const stage of ["CONTACT_INPUT","CONTACT_CONFIRM","REVIEW","DELIVERY"]) {
    assert.deepEqual(articlesStartingFreshTelegramSearch(stage,"2711800109"),["2711800109"]);
    assert.deepEqual(articlesStartingFreshTelegramSearch(stage,"A2711800109"),["A2711800109"]);
    assert.deepEqual(articlesStartingFreshTelegramSearch(stage,"A2711800109\nA1673200603"),
      ["A2711800109","A1673200603"]);
  }
});
test("Contact details and optional comments do not accidentally reset checkout",()=>{
  assert.equal(articlesStartingFreshTelegramSearch("CONTACT_INPUT",
    "Іван Петренко +380501234567"),null);
  assert.equal(articlesStartingFreshTelegramSearch("CONTACT_INPUT","+380501234567"),null);
  assert.equal(articlesStartingFreshTelegramSearch("CONTACT_INPUT","0501234567"),null);
  assert.equal(articlesStartingFreshTelegramSearch("CONTACT_INPUT","Іван"),null);
  assert.equal(articlesStartingFreshTelegramSearch("COMMENT_INPUT","2711800109"),null);
  assert.equal(articlesStartingFreshTelegramSearch("COMMENT_CHOICE","A2711800109"),null);
  assert.equal(articlesStartingFreshTelegramSearch("PROCESSING","A2711800109"),null);
});
test("Checkout has a fresh-search escape hatch but approved basket controls stay unchanged",()=>{
  for(const stage of ["CONTACT_INPUT","CONTACT_CONFIRM","COMMENT_CHOICE",
    "COMMENT_INPUT","REVIEW","CITY_CHOICE","POINT_CHOICE"]) {
    const v=renderTelegramOrder({stage,draft:{},sessionKey:"aabbccdd11"});
    const controls=v.reply_markup.inline_keyboard.flat();
    assert.ok(controls.some(x=>x.text==="🔍 Новий пошук"&&
      x.callback_data==="mo:aabbccdd11:newsearch"),stage);
  }
  assert.ok(deliveryKeyboard("aabbccdd11").inline_keyboard.flat().some(x=>
    x.callback_data==="mo:aabbccdd11:newsearch"));
  const basket=renderTelegramOrder({stage:"EDIT",draft:{items:[{
    article:"A2711800109",name:"Фільтр",quantity:1,
    offers:[{offerId:42,quantity:5,price:150,sourceType:"OWN_STOCK"}],
  }]},sessionKey:"aabbccdd11"});
  assert.deepEqual(basket.reply_markup.inline_keyboard[0].map(x=>x.text),
    ["1 шт.","−","+","🗑"]);
  assert.equal(basket.reply_markup.inline_keyboard.length,5);
});

test("A single result has no №1 in search or cart; multiple results remain numbered",()=>{
  const product={article:"A1673200603",name:"Стійка амортизаційна",
    quantity:1,selectedOffer:0,
    offers:[{offerId:218,quantity:2,price:104353.47,sourceType:"OWN_STOCK"}]};
  const cart=renderTelegramOrder({stage:"CART",draft:{items:[product]},sessionKey:"aabbccdd11"});
  assert.deepEqual(cart.reply_markup.inline_keyboard[0].map(b=>b.text),
    ["1 шт.","−","+","🗑"]);
  assert.deepEqual(cart.reply_markup.inline_keyboard[0].map(b=>b.callback_data),[
    "mo:aabbccdd11:q:0","mo:aabbccdd11:m:0",
    "mo:aabbccdd11:p:0","mo:aabbccdd11:x:0",
  ]);
  assert.match(cart.text,/^🛒 <b>Ваш кошик<\/b>\n<a href="https:\/\/maka\.com\.ua\/uk\/product\/A1673200603">A1673200603<\/a>/);
  assert.doesNotMatch(cart.text,/1\. <a href=/);
  const search=renderTelegramOrder({stage:"EDIT",draft:{items:[product]},sessionKey:"aabbccdd11"});
  assert.equal(search.reply_markup.inline_keyboard[0][0].text,"1 шт.");
  assert.match(search.text,/href="https:\/\/maka\.com\.ua\/uk\/product\/A1673200603">A1673200603<\/a>/);
  assert.doesNotMatch(search.text,/1\. <a href=/);
  const both=renderTelegramOrder({stage:"CART",draft:{items:[product,{
    ...product,article:"A2711800109",offers:[{...product.offers[0],offerId:219}],
  }]},sessionKey:"aabbccdd11"});
  assert.equal(both.reply_markup.inline_keyboard[0][0].text,"№1");
  assert.equal(both.reply_markup.inline_keyboard[1][0].text,"№2");
  assert.match(both.text,/1\. <a href="https:\/\/maka\.com\.ua\/uk\/product\/A1673200603">A1673200603<\/a>/);
  assert.match(both.text,/2\. <a href="https:\/\/maka\.com\.ua\/uk\/product\/A2711800109">A2711800109<\/a>/);
});
