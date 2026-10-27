import test from "node:test";
import assert from "node:assert/strict";
import { websiteStaffVariants } from "./WebsiteStaffVariantService.js";

test("staff family includes stocked Mercedes own base and supplier variant even if public family omits own", async () => {
  const base = {id:1, article:"A1673200603"};
  const same = {id:2, article:"A167320060380"};
  const read = {
    found:true,
    searchResult:{exactProduct:base,family:[base,same]},
    response:{locale:"uk", productCard:{product:base,offers:[]},family:[]}
  };
  const calls=[];
  const result=await websiteStaffVariants(read,{
    getOffers:async ids=>{
      assert.deepEqual(ids,[1,2]);
      return new Map([
        [1,[{id:91,isAvailable:true,quantity:2,retailPrice:100}]],
        [2,[{id:92,isAvailable:true,quantity:1,retailPrice:90}]]
      ]);
    },
    present:async args=>{
      calls.push(args);
      return {family:args.family};
    }
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].includeSourceDetails,true);
  assert.deepEqual(result.map(x=>x.product.article),
    ["A1673200603","A167320060380"]);
  assert.deepEqual(result.map(x=>x.offers[0].id),[91,92]);
  assert.deepEqual(read.response.family,[],"Public search output must not be mutated");
});

test("staff variant presentation excludes unavailable and zero-priced offers",async()=>{
  const read={found:true,searchResult:{exactProduct:{id:1,article:"A1673200603"},
    family:[{id:1,article:"A1673200603"},{id:2,article:"A167320060380"}]},
    response:{locale:"ru"}};
  const cards=await websiteStaffVariants(read,{
    getOffers:async()=>new Map([
      [1,[{id:3,isAvailable:false,quantity:0,retailPrice:100}]],
      [2,[{id:4,isAvailable:true,quantity:3,retailPrice:250}]]
    ]),
    present:async input=>({family:input.family}),
  });
  assert.deepEqual(cards.map(c=>c.product.article),["A167320060380"]);
});
