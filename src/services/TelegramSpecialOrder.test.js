import test from "node:test";
import assert from "node:assert/strict";
import {searchTelegramCatalog} from "./TelegramCatalogService.js";
import {websiteOrderItem,websiteSpecialOrder} from "./MakatronSharedSiteSearchClient.js";
import {selectTelegramOffers,editTelegramItem,refreshTelegramCartItems} from "./TelegramOrderService.js";
import {renderTelegramOrder} from "./TelegramOrderView.js";
import {mergeTelegramCartItems} from "../repositories/TelegramShoppingCartRepository.js";

const article="A1676703800";
const special=(price=32085.51,number=article)=>({
  sourceType:"SPECIAL_ORDER",article:number,articleNormalized:number,
  indicativePriceUah:price,currency:"UAH",availabilityStatus:"ON_REQUEST",
  quantity:null,isAvailable:false,checkoutEnabled:false,requiresConfirmation:true,
  internalCost:10,priceMatrix:[{group:"OTHER_CLIENT",price:20}],
});
const answer=(price=32085.51)=>({success:true,locale:"uk",productCard:null,
  family:[],specialOrder:special(price)});
const stock={product:{id:1,article,name:"Деталь"},offers:[{
  id:10,sourceType:"OWN_STOCK",quantity:2,isAvailable:true,retailPrice:900,
}]};

async function search(text,data,{viewer=null,locale="uk",calls=[]}={}) {
  const old=process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED;
  process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED="true";
  try {
    return await searchTelegramCatalog({text,chatId:42,telegramUserId:42},{
      getLocale:async()=>locale,resolveViewer:async()=>viewer,
      searchWebsite:async request=>{calls.push(request);return typeof data==="function"?data(request):data;},
      pricing:async()=>{throw Error("Must use website pricing");},
      search:async()=>{throw Error("Must use website search");},
    });
  }finally{
    if(old===undefined)delete process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED;
    else process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED=old;
  }
}

test("TXT-only search returns price, lead time and inquiry link, without false stock",async()=>{
  const [r]=await search(article,answer());
  assert.match(r.text,/Під замовлення: <b>32.085,51 грн<\/b>/);
  assert.match(r.text,/Близько 2 тижнів/);
  assert.match(r.text,/менеджер/);
  assert.match(r.text,/href="https:\/\/maka.com.ua\/uk\?article=A1676703800">Залишити заявку/);
  assert.doesNotMatch(r.text,/В наявності|OTHER_CLIENT|internalCost|priceMatrix|До кошика/);
});

test("real warehouse stock wins even if a response also contains TXT metadata",async()=>{
  const [r]=await search(article,{...answer(),productCard:stock});
  assert.match(r.text,/900 грн/);
  assert.match(r.text,/В наявності/);
  assert.doesNotMatch(r.text,/Під замовлення|32.085/);
});

test("customer TXT reply includes an available title, escaped, without staff pricing fields",async()=>{
 const data={...answer(),specialOrder:{...special(),title:'  Тяга <Mercedes> & опора  ',discountGroup:'18',retailPriceUah:34133.52}};
 const [r]=await search(article,data);
 assert.match(r.text,/<code>A1676703800<\/code> — Тяга &lt;Mercedes&gt; &amp; опора/);
 assert.match(r.text,/32.085,51 грн/);
 assert.doesNotMatch(r.text,/<Mercedes>|discountGroup|Роздріб|34.133,52|Група знижки/);
 const item=websiteOrderItem(data,article,selectTelegramOffers);
 assert.equal(item.specialOrder.title,'Тяга <Mercedes> & опора');
 const inline=renderTelegramOrder({stage:'EDIT',draft:{items:[item]},sessionKey:'test'});
 assert.match(inline.text,/Тяга &lt;Mercedes&gt; &amp; опора/);
});

test("empty TXT titles stay omitted and 20 escaped names keep inline replies bounded",async()=>{
 const [empty]=await search(article,{...answer(),specialOrder:{...special(),title:'   '}});
 assert.match(empty.text,/<\/code> — Під замовлення:/);
 const items=Array.from({length:20},(_,i)=>websiteOrderItem({success:true,
  specialOrder:{...special(32085.51,'A'+String(i+1).padStart(10,'0')),title:'<&>'.repeat(100)}},article,selectTelegramOffers));
 const view=renderTelegramOrder({stage:'EDIT',draft:{items},sessionKey:'test'});
 assert.ok(view.text.length<4096);
 assert.equal((view.text.match(/Під замовлення/g)||[]).length,20);
 assert.doesNotMatch(view.text,/<&>/);
});

test("an empty or unavailable catalog card does not hide the TXT fallback",async()=>{
  const [r]=await search(article,{...answer(),productCard:{...stock,
    offers:[{...stock.offers[0],quantity:0,isAvailable:false}]}});
  assert.match(r.text,/Під замовлення/);
  assert.doesNotMatch(r.text,/900 грн|В наявності/);
});

test("guests and linked clients retain their own website pricing identity",async()=>{
  for(const viewer of [null,{userId:123}]){
    const calls=[];
    const [r]=await search(article,req=>answer(req.userId?29000:32085.51),{viewer,calls});
    assert.deepEqual(calls,[{article,locale:"uk",mode:viewer?"client":"guest",userId:viewer?.userId??null}]);
    assert.match(r.text,viewer?/29.000 грн/:/32.085,51 грн/);
  }
});

test("canonical TXT article links survive omitted A, Cyrillic A and spaces",async()=>{
  for(const input of ["1676703800","А1676703800","A 167 670 38 00"]){
    const calls=[];
    const [r]=await search(input,answer(),{calls});
    assert.equal(calls[0].article,input,"Normalization stays with the website API");
    assert.match(r.text,/<code>A1676703800<\/code>/);
    assert.match(r.text,/\?article=A1676703800/);
  }
});

test("English TXT response and inquiry URL use the selected language",async()=>{
  const [r]=await search(article,{...answer(),locale:"en"},{locale:"en"});
  assert.match(r.text,/On order: <b>32,085.51 UAH/);
  assert.match(r.text,/About 2 weeks/);
  assert.match(r.text,/\/en\?article=/);
  assert.doesNotMatch(r.text,/Під замовлення|грн/);
});

test("a missing TXT price stays unavailable rather than fabricating a quote",async()=>{
  const [r]=await search(article,{success:true,productCard:{...stock,offers:[]}});
  assert.match(r.text,/немає в наявності/);
  assert.doesNotMatch(r.text,/Під замовлення|900 грн/);
  const [missing]=await search(article,{success:false});
  assert.match(missing.text,/не знайдено/);
});

test("malformed TXT metadata and checkout-capable data cannot become special quotes",()=>{
  for(const patch of [
    {indicativePriceUah:0},{indicativePriceUah:-1},{indicativePriceUah:NaN},
    {indicativePriceUah:Infinity},{currency:"EUR"},{checkoutEnabled:true},
    {sourceType:"SUPPLIER"},{isAvailable:true},{quantity:3},
    {requiresConfirmation:false},{availabilityStatus:"IN_STOCK"},
    {article:'<a href="bad">'},
  ])assert.equal(websiteSpecialOrder({...answer(),specialOrder:{...special(),...patch}}),null);
  assert.equal(websiteSpecialOrder({...answer(),success:false}),null);
  assert.deepEqual(websiteSpecialOrder(answer()),{article,indicativePriceUah:32085.51});
});

test("20 mixed results retain all quotes, valid links and bounded Telegram messages",async()=>{
  const articles=Array.from({length:20},(_,i)=>"A"+String(i+1).padStart(10,"0"));
  const out=await search(articles.join("\n"),req=>{
    const i=articles.indexOf(req.article);
    return i%2?{...answer(),specialOrder:special(1000+i,req.article)}:
      {success:true,productCard:{...stock,product:{...stock.product,article:req.article}}};
  });
  const text=out.map(r=>r.text).join("\n");
  for(const number of articles)assert.ok(text.includes(number));
  assert.equal((text.match(/Під замовлення/g)||[]).length,10);
  for(const r of out){
    assert.ok(r.text.length<4096);
    assert.equal((r.text.match(/<a /g)||[]).length,(r.text.match(/<\/a>/g)||[]).length);
  }
});

test("inline search shows TXT quote without quantities, checkout or a fake offer",()=>{
  const item=websiteOrderItem(answer(),article,selectTelegramOffers);
  assert.deepEqual(item.offers,[]);
  assert.equal(item.quantity,0);
  assert.equal(editTelegramItem(item,"p").quantity,0);
  assert.equal(mergeTelegramCartItems([], [{...item,quantity:1}]).items.length,0);
  const r=renderTelegramOrder({stage:"EDIT",draft:{items:[item]},sessionKey:"test"});
  assert.match(r.text,/Під замовлення: <b>32.085,51 грн/);
  assert.doesNotMatch(r.text,/Разом|Не знайдено|Обрано/);
  const buttons=r.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(b=>b.url===`https://maka.com.ua/uk?article=${article}`));
  assert.ok(!buttons.some(b=>/[+−]|Додати вибране/.test(b.text)));
});

test("inline stock wins and mixed totals exclude special order prices",()=>{
  const inStock=websiteOrderItem({...answer(),productCard:stock},article,selectTelegramOffers);
  assert.equal(inStock.specialOrder,undefined);
  const item=websiteOrderItem(answer(),article,selectTelegramOffers);
  const r=renderTelegramOrder({stage:"EDIT",draft:{items:[{...inStock,quantity:1},item]},sessionKey:"test"});
  assert.match(r.text,/Разом: 900 грн/);
  assert.match(r.text,/32.085,51 грн/);
});

test("20 inline special orders fit in one reply and keep safe inquiry buttons",()=>{
  const items=Array.from({length:20},(_,i)=>websiteOrderItem({success:true,
    specialOrder:special(32085.51,"A"+String(i+1).padStart(10,"0"))},article,selectTelegramOffers));
  const r=renderTelegramOrder({stage:"EDIT",draft:{items},sessionKey:"test"});
  assert.ok(r.text.length<4096);
  assert.equal((r.text.match(/Під замовлення/g)||[]).length,20);
  assert.equal(r.reply_markup.inline_keyboard.flat().filter(b=>b.url).length,10);
  assert.ok(r.reply_markup.inline_keyboard.flat().length<=100);
});

test("a saved stock cart never converts a missing offer into a TXT checkout item",async()=>{
  const existing={article,quantity:1,selectedOffer:0,offers:[{offerId:10,quantity:2,price:900}]};
  const result=await refreshTelegramCartItems([existing],{
    resolveItem:async()=>websiteOrderItem(answer(),article,selectTelegramOffers),
  });
  assert.equal(result.changed,true);
  assert.equal(result.items[0].quantity,0);
  assert.deepEqual(result.items[0].offers,[]);
  assert.equal(result.items[0].specialOrder,undefined);
});
