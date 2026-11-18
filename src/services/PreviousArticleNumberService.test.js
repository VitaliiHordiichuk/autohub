import test from 'node:test';
import assert from 'node:assert/strict';
import { findPreviousArticleProducts, buildPreviousArticleCards, availablePreviousArticleCards } from './PreviousArticleNumberService.js';

test('previous-number lookup normalizes Cyrillic/spaces and keeps the exact brand',async()=>{
 let seen;
 await findPreviousArticleProducts({article:'а 222-222 22 22',searchResult:{exactProduct:{brand_id:4,article_normalized:'A2222222222'}}},{find:async a=>(seen=a,[])});
 assert.deepEqual(seen,{articleCandidates:['A2222222222'],brandId:4});
});
test('previous numbers can be found without A and without a new catalogue card',async()=>{
 let seen;
 await findPreviousArticleProducts({article:'2222222222',searchResult:{found:false}},{find:async a=>(seen=a,[])});
 assert.deepEqual(seen,{articleCandidates:['2222222222','A2222222222'],brandId:null});
});
test('a prefix suggestion does not prove a brand or replacement target',async()=>{
 let seen;
 await findPreviousArticleProducts({article:'2222222222',searchResult:{numberResolution:'PREFIX',exactProduct:{brand_id:9,article_normalized:'A22222222229051'}}},{find:async a=>(seen=a,[])});
 assert.equal(seen.brandId,null);
 assert.ok(!seen.articleCandidates.includes('A22222222229051'));
});
test('explicit canonical target is included without losing the original query',async()=>{
 let seen;
 await findPreviousArticleProducts({article:'A1111111111',searchResult:{numberResolution:'REPLACEMENT',exactProduct:{brand_id:1,article_normalized:'A3333333333'}}},{find:async a=>(seen=a,[])});
 assert.deepEqual(seen.articleCandidates,['A1111111111','A3333333333']);
});
test('empty queries never access replacement storage',async()=>{
 const rows=await findPreviousArticleProducts({article:'',searchResult:null},{find:()=>assert.fail('unexpected lookup')});
 assert.deepEqual(rows,[]);
});
test('previous stock keeps its own product, offer, price and buyer availability context',async()=>{
 const product={id:11,article:'A1111111111'};const context={priceGroupName:'VIP'},availability={userId:44,cartId:55};
 const offer={id:71,productId:11,sourceType:'OWN_STOCK',isAvailable:true,quantity:2,retailPrice:357};
 const cards=await buildPreviousArticleCards([product],context,availability,{getOffers:async(ids,p,locale,a)=>{
  assert.deepEqual(ids,[11]);assert.equal(p,context);assert.equal(a,availability);assert.equal(locale,'uk');return new Map([[11,[offer]]]);
 }});
 assert.equal(cards[0].product,product);assert.equal(cards[0].offers[0],offer);
});
test('only actually available previous warehouse offers are presented',()=>{
 const valid={id:1,sourceType:'OWN_STOCK',isAvailable:true,quantity:2,retailPrice:100};
 const cards=availablePreviousArticleCards([{product:{id:1},offers:[valid,{...valid,id:2,quantity:0},{...valid,id:3,isAvailable:false},{...valid,id:4,sourceType:'PARTNER_STOCK'},{...valid,id:5,retailPrice:0}]},{product:{id:2},offers:[]}]);
 assert.equal(cards.length,1);assert.deepEqual(cards[0].offers,[valid]);
});
