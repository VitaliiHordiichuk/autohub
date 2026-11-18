import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../config/db.js';
import { PublicSearchPresenterService } from './PublicSearchPresenterService.js';

test('previous number cards use the public translation and offer privacy boundary',async(t)=>{
 t.mock.method(pool,'query',async(sql,params)=>{
  if(sql.includes('ANY($1::bigint[])')){
   assert.deepEqual(params,[[11],'uk']);
   return {rows:[{id:11,public_name:'Попередня деталь',translation_locale:'uk',name_provider:'MANUAL',image_urls:[],image_variants:[]}]};
  }
  if(sql.includes('FROM site_languages'))return {rows:[{code:'uk'}]};
  assert.fail('Unexpected query');
 });
 const result=await PublicSearchPresenterService.present({requestedLocale:'uk',family:[],productCard:null,
  previousNumberCards:[{product:{id:11,article:'A1111111111',name:'Raw name'},offers:[
   {id:71,productId:11,sourceType:'OWN_STOCK',isAvailable:true,quantity:2,retailPrice:357,warehouse:{name:'Private warehouse',city:'Харків'},supplier:{name:'Private supplier'},incomingCost:123,secret:'hidden'},
   {id:72,productId:11,sourceType:'OWN_STOCK',isAvailable:false,quantity:0,retailPrice:400},
  ]}],
 });
 const card=result.previousNumberCards[0];
 assert.equal(card.product.name,'Попередня деталь');assert.equal(card.product.article,'A1111111111');
 assert.equal(card.offers.length,1);assert.equal(card.offers[0].retailPrice,357);
 assert.equal(card.offers[0].id,71);assert.equal(card.offers[0].productId,11);
 assert.equal(card.offers[0].sourceDetails,undefined);assert.equal(card.offers[0].incomingCost,undefined);
 assert.ok(!JSON.stringify(card).includes('Private supplier'));assert.ok(!JSON.stringify(card).includes('hidden'));
});
