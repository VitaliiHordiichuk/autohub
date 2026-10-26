import test from "node:test";
import assert from "node:assert/strict";
import { searchForMakatron,quoteForMakatron } from "./makatron-search-bridge.controller.js";

const makeRes=()=>({statusCode:200,body:null,set(){return this;},
 status(code){this.statusCode=code;return this;},
 json(data){this.body=data;return this;}});
function req(secret,body){
 return {body,get:(name)=>name==="X-Makatron-Search-Key"?secret:""};
}
const old=process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
const secret="t".repeat(48);
test("missing and wrong server secret reveal neither staff prices nor user records",async()=>{
 delete process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
 const first=makeRes();
 await searchForMakatron(req(secret,{article:"A2966808206",mode:"staff",userId:2}),first);
 assert.equal(first.statusCode,503);
 process.env.MAKATRON_SEARCH_BRIDGE_SECRET=secret;
 const second=makeRes();
 await searchForMakatron(req("bad",{article:"A2966808206",mode:"staff",userId:2}),second,{
  db:{query:async()=>{throw Error("No database queries without valid secret");}}
 });
 assert.equal(second.statusCode,403);
});
test("guest cannot impersonate staff, and normal client receives no incoming cost",async()=>{
 process.env.MAKATRON_SEARCH_BRIDGE_SECRET=secret;
 const db={query:async()=>({rows:[{name:"CLIENT"}]})};
 const unauthorized=makeRes();
 await searchForMakatron(req(secret,{article:"A2966808206",mode:"staff",userId:2}),unauthorized,{db});
 assert.equal(unauthorized.statusCode,403);
 const client=makeRes();
 await searchForMakatron(req(secret,{article:"A2966808206",mode:"client",userId:42}),client,{
  db,read:async args=>{
    assert.equal(args.article,"A2966808206");
    assert.equal(args.userId,42,"Use the currently verified client ID");
    assert.equal(args.includeSourceDetails,false);
    assert.deepEqual(args.availabilityContext,{userId:42,cartId:null});
    return {found:true,response:{success:true,productCard:{product:{id:1},offers:[]}}};
  },
  staffPrices:async()=>{throw Error("client cannot invoke staff prices")}
 });
 assert.equal(client.statusCode,200);
 assert.equal(client.body.staffPrices,undefined);
});
test("verified staff alone receives server-computed private price data",async()=>{
 process.env.MAKATRON_SEARCH_BRIDGE_SECRET=secret;
 const res=makeRes();
 await searchForMakatron(req(secret,{article:"A2966808206",mode:"staff",userId:2}),res,{
  db:{query:async()=>({rows:[{name:"ADMIN"}]})},
  read:async()=>({found:true,response:{success:true,productCard:null,family:[]}}),
  staffPrices:async()=>({"9":{retail:200,incoming:"100.123456",vip:150}})
 });
 assert.equal(res.statusCode,200);
 assert.equal(res.body.staffPrices["9"].vip,150);
 const quote=makeRes();
 await quoteForMakatron(req(secret,{offerId:9,group:"VIP",userId:2}),quote,{
  db:{query:async()=>({rows:[{name:"ADMIN"}]})},
  quote:async()=>({text:"A2966808206 — 150 грн"})
 });
 assert.equal(quote.body.text,"A2966808206 — 150 грн");
});
test.after(()=>{if(old===undefined)delete process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
 else process.env.MAKATRON_SEARCH_BRIDGE_SECRET=old;});
