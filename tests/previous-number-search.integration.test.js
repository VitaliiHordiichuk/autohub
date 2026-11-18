import { describe, test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/config/db.js';
import { ArticleNumberRepository } from '../src/repositories/ArticleNumberRepository.js';
import { findPreviousArticleProducts } from '../src/services/PreviousArticleNumberService.js';
import { readWebsiteArticleSearch } from '../src/services/WebsiteArticleSearchService.js';

const enabled=process.env.MAKA_REPLACEMENT_TEST_DB==='true';
describe('previous-number search in an isolated local PostgreSQL', {skip:!enabled},()=>{
 before(async()=>{
  assert.ok(process.env.DB_HOST?.startsWith('/tmp/maka-reverse-replacements-pg-'));
  assert.equal(process.env.DB_NAME,'maka_reverse_replacements_test');
  await pool.query(`
   CREATE TABLE brands(id integer PRIMARY KEY,name text,is_active boolean DEFAULT true);
   CREATE TABLE vehicle_brands(id integer PRIMARY KEY,name text);
   CREATE TABLE part_manufacturers(id integer PRIMARY KEY,name text);
   CREATE TABLE product_types(id integer PRIMARY KEY,name text);
   CREATE TABLE products(id integer PRIMARY KEY,brand_id integer,article text,article_normalized text,name text,
    article_base text,article_suffix text,article_suffix_length integer DEFAULT 0,variant_type text DEFAULT 'BASE',
    is_active boolean DEFAULT true,vehicle_brand_id integer,manufacturer_id integer,product_type_id integer);
   CREATE TABLE article_number_links(id serial PRIMARY KEY,source_brand_id integer,source_article text,source_article_normalized text,
    target_brand_id integer,target_article text,target_article_normalized text,link_type text,is_active boolean DEFAULT true);
   INSERT INTO brands VALUES(1,'Mercedes-Benz',true),(2,'Other',true);
  `);
 });
 beforeEach(async()=>{await pool.query('TRUNCATE article_number_links,products RESTART IDENTITY')});
 after(async()=>{await pool.end()});
 async function product(id,article,brand=1,active=true){
  await pool.query('INSERT INTO products(id,brand_id,article,article_normalized,name,article_base,is_active) VALUES($1,$2,$3,$3,$4,$3,$5)',[id,brand,article,'Part '+id,active]);
 }
 async function link(source,target,{sourceBrand=1,targetBrand=1,type='REPLACEMENT',active=true}={}){
  await pool.query('INSERT INTO article_number_links(source_brand_id,source_article,source_article_normalized,target_brand_id,target_article,target_article_normalized,link_type,is_active) VALUES($1,$2,$2,$3,$4,$4,$5,$6)',[sourceBrand,source,targetBrand,target,type,active]);
 }
 const find=article=>findPreviousArticleProducts({article,searchResult:{found:false}});
 test('new number finds an old catalogue product even without its own product card',async()=>{
  await product(1,'A1111111111');await link('A1111111111','A2222222222');
  assert.deepEqual((await find('A2222222222')).map(p=>p.id),[1]);
  assert.deepEqual((await find('2222222222')).map(p=>p.id),[1]);
  assert.deepEqual((await find('а 222-222 22 22')).map(p=>p.id),[1]);
 });
 test('multi-step and converging replacement chains return all previous products once',async()=>{
  await product(1,'A1111111111');await product(2,'A2222222222');await product(3,'A3333333333');
  await link('A1111111111','A2222222222');await link('A2222222222','A9999999999');
  await link('A3333333333','A2222222222');await link('A1111111111','A9999999999');
  assert.deepEqual((await find('A9999999999')).map(p=>p.id),[1,2,3]);
 });
 test('inactive links, inactive products and analogs never become previous numbers',async()=>{
  await product(1,'A1111111111');await product(2,'A2222222222',1,false);await product(3,'A3333333333');
  await link('A1111111111','A9999999999',{active:false});await link('A2222222222','A9999999999');
  await link('A3333333333','A9999999999',{type:'ANALOG'});
  assert.deepEqual(await find('A9999999999'),[]);
 });
 test('alias bridges preserve a replacement chain but an alias alone is not a replacement',async()=>{
  await product(1,'A1111111111');await product(2,'ALT22222');
  await link('A1111111111','ALT22222');await link('ALT22222','A9999999999',{type:'ALIAS'});
  assert.deepEqual((await find('A9999999999')).map(p=>p.id),[1]);
 });
 test('cycles terminate and do not return the requested root as its own previous number',async()=>{
  await product(1,'A1111111111');await product(2,'A2222222222');
  await link('A1111111111','A2222222222');await link('A2222222222','A1111111111');
  await pool.query("SET statement_timeout='2s'");
  assert.deepEqual((await find('A2222222222')).map(p=>p.id),[1]);
 });
 test('ambiguous target brands fail closed until a real exact product identifies the brand',async()=>{
  await product(1,'A1111111111');await product(2,'OTHER111',2);
  await link('A1111111111','A9999999999');await link('OTHER111','A9999999999',{sourceBrand:2,targetBrand:2});
  assert.deepEqual(await find('A9999999999'),[]);
  const rows=await ArticleNumberRepository.findPreviousReplacementProducts({articleCandidates:['A9999999999'],brandId:1});
  assert.deepEqual(rows.map(p=>p.id),[1]);
 });
 test('full shared read model prioritizes old stock when a new product does not exist',async()=>{
  await product(1,'A1111111111');await link('A1111111111','A2222222222');
  let txtCalls=0;
  const result=await readWebsiteArticleSearch({article:'A2222222222',userId:44},{
   pricing:async()=>({priceGroupName:'VIP'}),
   buildPrevious:async rows=>rows.map(product=>({product,offers:[{id:51,productId:product.id,sourceType:'OWN_STOCK',isAvailable:true,quantity:3,retailPrice:987}]})),
   present:async args=>({...args,locale:'uk'}),specialOrderEnabled:true,specialOrder:async()=>{txtCalls++;return null},
  });
  assert.equal(result.found,true);assert.equal(result.response.productCard,null);
  assert.equal(result.response.previousNumberCards[0].product.article,'A1111111111');
  assert.equal(result.response.previousNumberCards[0].offers[0].retailPrice,987);assert.equal(txtCalls,0);
 });
});
