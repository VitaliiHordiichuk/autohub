import test from "node:test";
import assert from "node:assert/strict";
import { siteSearchEnabled,searchWebsiteArticle,quoteWebsiteOffer,
  websiteSearchCards,websiteOrderItem } from "./MakatronSharedSiteSearchClient.js";

const product=(id,article,offers=[])=>({product:{id,article,name:"Деталь "+id},offers});

test("Telegram clients call only the running MAKA website backend",async()=>{
 const prior=process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
 process.env.MAKATRON_SEARCH_BRIDGE_SECRET="c".repeat(48);
 const calls=[];
 try{
  const result=await searchWebsiteArticle({article:"A2966808206",mode:"client",userId:42},{
   fetchImpl:async(url,init)=>{
    calls.push({url,init});
    return {ok:true,status:200,json:async()=>({
      success:true,productCard:product(1,"A2966808206"),
      family:[product(2,"A29668082069051")]
    })};
   }
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"http://127.0.0.1:4000/api/search/telegram-shared");
  assert.equal(calls[0].init.method,"POST");
  assert.equal(JSON.parse(calls[0].init.body).userId,42);
  assert.equal(JSON.parse(calls[0].init.body).mode,"client");
  assert.equal(result.family[0].product.article,"A29668082069051");
 }finally{
  if(prior===undefined)delete process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
  else process.env.MAKATRON_SEARCH_BRIDGE_SECRET=prior;
 }
});
test("Site cards are the only candidates for Telegram, not guessed Mercedes suffixes",()=>{
 const data={success:true,
  productCard:product(1,"A2966808206"),
  family:[product(2,"A29668082069051",[{id:33,sourceType:"OWN_STOCK",
    retailPrice:100,quantity:2,isAvailable:true}])]};
 assert.deepEqual(websiteSearchCards(data).map(c=>c.product.article),
  ["A2966808206","A29668082069051"]);
 const item=websiteOrderItem(data,"A2966808206",
   offers=>offers.filter(o=>o.isAvailable).map(o=>({
    offerId:o.id,quantity:o.quantity,price:o.retailPrice,sourceType:o.sourceType
   })));
 assert.equal(item.article,"A29668082069051");
 assert.equal(item.requestedArticle,"A2966808206");
 assert.equal(item.offers[0].offerId,33);
});
test("Account identifiers and secret never travel in query strings",async()=>{
 const old=process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
 process.env.MAKATRON_SEARCH_BRIDGE_SECRET="s".repeat(48);
 try{
  const captured=[];
  await quoteWebsiteOffer({offerId:99,group:"VIP",userId:2},{
   fetchImpl:async(url,init)=>{
    captured.push({url,body:JSON.parse(init.body)});
    return {ok:true,status:200,json:async()=>({text:"A0009953033 — 1 732,43 грн"})};
   }
  });
  assert.equal(captured[0].url,"http://127.0.0.1:4000/api/search/telegram-quote");
  assert.deepEqual(captured[0].body,{offerId:99,group:"VIP",userId:2});
  assert.equal(siteSearchEnabled(),false);
 }finally{
  if(old===undefined)delete process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
  else process.env.MAKATRON_SEARCH_BRIDGE_SECRET=old;
 }
});
test("Without a configured secret, bridge denies search instead of falling back",async()=>{
 const old=process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
 delete process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
 try{
  await assert.rejects(searchWebsiteArticle({article:"A123",mode:"guest"}),/secret missing/);
 }finally{
  if(old!==undefined)process.env.MAKATRON_SEARCH_BRIDGE_SECRET=old;
 }
});
