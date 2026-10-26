import test from "node:test";
import assert from "node:assert/strict";
import { resolveTelegramExtendedArticle,switchTelegramArticleAlternative } from "./TelegramExtendedArticleService.js";
import { renderTelegramOrder } from "./TelegramOrderView.js";
import { mergeTelegramCartItems } from "../repositories/TelegramShoppingCartRepository.js";

const product=(article,id)=>({id,article,article_normalized:article,brand_name:"Mercedes-Benz"});
const base=product("A1673200503",101);
const same=product("A167320050380",102);
const variant=product("A16732005039051",103);
const quote=(p)=>({
  article:p.article,name:"Стійка амортизаційна",quantity:0,selectedOffer:0,
  offers:p.id===102?[{offerId:902,sourceType:"OWN_STOCK",quantity:2,price:94638.65}]:[],
});
test("Mercedes base without stock resolves actual two-digit SAME article from family",async()=>{
  const called=[];
  const result=await resolveTelegramExtendedArticle({
    article:"1673200503",
    found:{found:true,rule:"MERCEDES",exactProduct:base,
      family:[base,same,variant]},
    quoteProduct:async p=>{called.push(p.article);return quote(p);},
  });
  assert.deepEqual(called,["A1673200503","A167320050380"]);
  assert.equal(result.article,"A167320050380");
  assert.equal(result.requestedArticle,"1673200503");
  assert.deepEqual(result.offers,[{offerId:902,sourceType:"OWN_STOCK",quantity:2,price:94638.65}]);
  assert.equal(result.quantity,0);
  const inList={...result,quantity:1};
  const v=renderTelegramOrder({stage:"EDIT",draft:{items:[inList]},sessionKey:"aabbccdd11"});
  assert.match(v.text,/1673200503 → <a href="https:\/\/maka\.com\.ua\/uk\/product\/A167320050380">A167320050380<\/a>/);
  assert.match(v.text,/94.638,65 грн/);
  assert.equal(v.reply_markup.inline_keyboard[0][0].text,"1 шт.");
  assert.equal(v.reply_markup.inline_keyboard[1][0].url,
    "https://maka.com.ua/uk/product/A167320050380");
  const cart=mergeTelegramCartItems([], [inList]).items;
  assert.deepEqual(cart.map(x=>x.article),["A167320050380"]);
  const cv=renderTelegramOrder({stage:"CART",draft:{items:cart},sessionKey:"aabbccdd11"});
  assert.match(cv.text,/product\/A167320050380/);
});

test("Exact stocked base wins; SAME fallback never hides its real offer",async()=>{
  let queried=[];
  const out=await resolveTelegramExtendedArticle({
    article:"A1673200503",
    found:{found:true,rule:"MERCEDES",exactProduct:base,family:[base,same]},
    quoteProduct:async p=>{queried.push(p.article);return {...quote(p),offers:[{offerId:801,quantity:2,price:100,sourceType:"OWN_STOCK"}]};},
  });
  assert.deepEqual(queried,["A1673200503","A167320050380"]);
  assert.equal(out.article,"A1673200503");
  assert.equal(out.requestedArticle,undefined);
});

test("Prefix-only result can use SAME article, but cannot promote a 4-digit VARIANT",async()=>{
  const prefix=await resolveTelegramExtendedArticle({
    article:"1673200503",found:{found:true,rule:"PREFIX",exactProduct:same,family:[same,variant]},
    quoteProduct:async p=>quote(p),
  });
  assert.equal(prefix.article,"A167320050380");
  assert.equal(prefix.requestedArticle,"1673200503");
  const bad=await resolveTelegramExtendedArticle({
    article:"1673200503",found:{found:true,rule:"MERCEDES",exactProduct:base,family:[base,variant]},
    quoteProduct:async p=>quote(p),
  });
  assert.deepEqual(bad.offers,[]);
  assert.equal(bad.article,"1673200503");
});

test("Non-Mercedes suffix or a fully specified suffix is never replaced automatically",async()=>{
  const other={...same,brand_name:"Volkswagen"};
  const calls=[];
  const nonMercedes=await resolveTelegramExtendedArticle({
    article:"1673200503",found:{found:true,rule:"PREFIX",exactProduct:base,
      family:[base,other]},
    quoteProduct:async p=>{calls.push(p.article);return quote(p);},
  });
  assert.equal(nonMercedes.offers.length,0);
  assert.deepEqual(calls,["A1673200503"]);
  const exactVariant=await resolveTelegramExtendedArticle({
    article:"A16732005039051",found:{found:true,rule:"MERCEDES",exactProduct:variant,
      family:[base,same,variant]},
    quoteProduct:async p=>quote(p),
  });
  assert.equal(exactVariant.offers.length,0);
});

test("Multi-query search displays one compact row per input with links and no previews",async()=>{
  const selected=await resolveTelegramExtendedArticle({
    article:"1673200503",found:{found:true,rule:"MERCEDES",
      exactProduct:base,family:[base,same,variant]},
    quoteProduct:async p=>quote(p),
  });
  const second={article:"A2711800109",name:"Масляний фільтр",quantity:1,
    selectedOffer:0,offers:[{offerId:903,quantity:4,price:1311.91,sourceType:"OWN_STOCK"}]};
  const v=renderTelegramOrder({stage:"EDIT",draft:{items:[{...selected,quantity:1},second]},
    sessionKey:"aabbccdd11"});
  assert.deepEqual(v.link_preview_options,{is_disabled:true});
  assert.equal((v.text.match(/\n\n\d\. /g)||[]).length,1);
  assert.match(v.text,/1\. 1673200503 → <a href="https:\/\/maka\.com\.ua\/uk\/product\/A167320050380">/);
  assert.match(v.text,/2\. <a href="https:\/\/maka\.com\.ua\/uk\/product\/A2711800109">/);
  assert.equal(v.reply_markup.inline_keyboard.filter(row=>row[0]?.text?.startsWith("№")).length,2);
});

test("Unknown numbers stay as unavailable, without synthetic offers or guessed matches",async()=>{
  const r=await resolveTelegramExtendedArticle({
    article:"1673200503",found:{found:false,family:[],exactProduct:null},
    quoteProduct:async()=>{throw Error("Must not quote unknown article");},
  });
  assert.deepEqual(r,{article:"1673200503",name:"",quantity:0,selectedOffer:0,offers:[]});
});

test("A long color/fitment VARIANT returned FIRST by prefix lookup is not auto-sold",async()=>{
  const requested="1673200503",visited=[];
  const found={found:true,rule:"MERCEDES",numberResolution:"PREFIX",
    exactProduct:variant,family:[variant,base,same]};
  const result=await resolveTelegramExtendedArticle({
    article:requested,found,
    quoteProduct:async p=>{
      visited.push(p.article);
      return {...quote(p),offers:[{offerId:p.id,quantity:1,price:222,sourceType:"OWN_STOCK"}]};
    },
  });
  assert.deepEqual(visited,["A167320050380"]);
  assert.equal(result.article,"A167320050380");
  assert.equal(result.requestedArticle,requested);
});
test("A long suffix alone is not sold as a base, even when prefix search finds it",async()=>{
  let quoted=false;
  const r=await resolveTelegramExtendedArticle({
    article:"1673200503",found:{found:true,rule:"PREFIX",
      exactProduct:variant,family:[variant]},
    quoteProduct:async()=>{quoted=true;return quote(variant);},
  });
  assert.equal(quoted,false);
  assert.deepEqual(r.offers,[]);
});

test("A batch of twenty Mercedes extensions remains inside Telegram limits",()=>{
  const items=Array.from({length:20},(_,i)=>({
    article:"A"+String(1673200500+i)+"80",
    requestedArticle:String(1673200500+i),
    name:"Стійка амортизаційна Mercedes-Benz",
    quantity:1,selectedOffer:0,offers:[
      {offerId:1000+i,sourceType:"OWN_STOCK",quantity:4,price:94638.65},
    ],
  }));
  const output=renderTelegramOrder({
    stage:"EDIT",draft:{items},sessionKey:"aabbccdd11",
  });
  assert.ok(output.text.length<4096,"Telegram HTML must fit a single complete message");
  assert.ok(output.reply_markup.inline_keyboard.flat().length<=100);
  assert.deepEqual(output.link_preview_options,{is_disabled:true});
  assert.equal((output.text.match(/ → /g)||[]).length,20);
});

test("Base quote with stock also shows the stocked 80 extension inside SAME item",async()=>{
  const product60=product("A1673200603",201);
  const extension60=product("A167320060380",202);
  const offersById=new Map([
    [201,[{offerId:1101,sourceType:"OWN_STOCK",quantity:2,price:104353.47}]],
    [202,[{offerId:1102,sourceType:"OWN_STOCK",quantity:1,price:94638.65}]],
  ]);
  const result=await resolveTelegramExtendedArticle({
    article:"1673200603",
    found:{found:true,rule:"MERCEDES",exactProduct:product60,
      family:[product60,extension60,variant]},
    quoteProduct:async p=>({
      article:p.article,name:"Стійка амортизаційна",selectedOffer:0,
      quantity:0,offers:offersById.get(p.id)||[],
    }),
  });
  assert.equal(result.article,"A1673200603");
  assert.equal(result.offers[0].offerId,1101);
  assert.deepEqual(result.alternatives.map(p=>p.article),["A167320060380"]);
  const current={...result,quantity:2};
  const before=renderTelegramOrder({stage:"EDIT",draft:{items:[current]},sessionKey:"aabbccdd11"});
  assert.match(before.text,/↳ Інший номер: <a href="https:\/\/maka\.com\.ua\/uk\/product\/A167320060380">A167320060380<\/a> · 1 шт\. · 94.638,65 грн\/шт\./);
  assert.match(before.text,/Разом: 208.706,94 грн/);
  assert.equal(before.reply_markup.inline_keyboard[1][0].callback_data,"mo:aabbccdd11:v:0");
  const chosen=switchTelegramArticleAlternative(current);
  assert.equal(chosen.article,"A167320060380");
  assert.equal(chosen.quantity,1,"max available stock of selected alternative");
  assert.equal(chosen.offers[0].offerId,1102);
  assert.equal(chosen.alternatives[0].article,"A1673200603");
  const after=renderTelegramOrder({stage:"EDIT",draft:{items:[chosen]},sessionKey:"aabbccdd11"});
  assert.match(after.text,/Разом: 94.638,65 грн/);
  assert.match(after.text,/↳ Інший номер: <a href="https:\/\/maka\.com\.ua\/uk\/product\/A1673200603"/);
  const cart=mergeTelegramCartItems([], [chosen]).items;
  assert.equal(cart.length,1,"one searched position adds only the chosen product");
  assert.equal(cart[0].offers[0].offerId,1102);
  const restored=switchTelegramArticleAlternative(chosen);
  assert.equal(restored.article,"A1673200603");
  assert.equal(restored.offers[0].offerId,1101);
  assert.equal(restored.quantity,1);
});

test("Batch result keeps related 80 extension under item 2, without another item or extra total",async()=>{
  const base60=product("A1673200603",301),extra60=product("A167320060380",302);
  const r=await resolveTelegramExtendedArticle({
    article:"1673200603",found:{found:true,rule:"MERCEDES",
      exactProduct:base60,family:[base60,extra60]},
    quoteProduct:async p=>({
      article:p.article,name:"Стійка амортизаційна",
      offers:[{offerId:p.id,quantity:p.id===301?2:1,
        price:p.id===301?104353.47:94638.65,sourceType:"OWN_STOCK"}],
      selectedOffer:0,quantity:0,
    }),
  });
  const first={article:"A2711800109",name:"Масляний фільтр",
    quantity:1,selectedOffer:0,
    offers:[{offerId:990,quantity:4,price:1311.91,sourceType:"OWN_STOCK"}]};
  const multi=renderTelegramOrder({
    stage:"EDIT",draft:{items:[first,{...r,quantity:1}]},sessionKey:"aabbccdd11",
  });
  assert.match(multi.text,/2\. <a href="https:\/\/maka\.com\.ua\/uk\/product\/A1673200603">/);
  assert.match(multi.text,/↳ Інший номер: <a href="https:\/\/maka\.com\.ua\/uk\/product\/A167320060380">/);
  assert.match(multi.text,/Разом: 105.665,38 грн/);
  assert.deepEqual(multi.link_preview_options,{is_disabled:true});
  assert.equal(multi.reply_markup.inline_keyboard.filter(row=>row[0]?.callback_data?.endsWith(":v:1")).length,1);
});
