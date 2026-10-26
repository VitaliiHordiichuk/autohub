import test from "node:test";
import assert from "node:assert/strict";
import { resolveTelegramExtendedArticle } from "./TelegramExtendedArticleService.js";
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
  assert.deepEqual(queried,["A1673200503"]);
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
