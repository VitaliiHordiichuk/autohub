import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { SiteTrafficRepository } from '../src/repositories/SiteTrafficRepository.js';
import { SITE_TRAFFIC_RETENTION_PREDICATE } from '../src/services/SiteTrafficPolicy.js';
import { runDataRetention } from '../src/services/DataRetentionService.js';

// Explicit opt-in to a fresh local temporary cluster; never uses application .env.
test('migration, deduplication, Kyiv day boundaries, permissions and real retention rule', { skip: !process.env.SITE_TRAFFIC_TEST_DB }, async()=>{
 assert.equal(process.env.SITE_TRAFFIC_TEST_DB,'maka_site_traffic_test');assert.equal(process.env.SITE_TRAFFIC_TEST_HOST,'/tmp/maka-site-traffic-pg-20261118');
 const db=new pg.Client({host:process.env.SITE_TRAFFIC_TEST_HOST,port:55438,database:process.env.SITE_TRAFFIC_TEST_DB,user:process.env.USER});await db.connect();
 try{
  await db.query('CREATE ROLE autohub_app');await db.query('CREATE TABLE schema_migrations(version VARCHAR PRIMARY KEY,executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const sql=fs.readFileSync(new URL('../migrations/133_create_site_traffic.sql',import.meta.url),'utf8');await db.query(sql);const start=(await db.query('SELECT executed_at FROM schema_migrations')).rows[0].executed_at;
  await db.query(sql);assert.deepEqual((await db.query('SELECT executed_at FROM schema_migrations')).rows[0].executed_at,start);
  const e={id:randomUUID(),visitorKey:'a'.repeat(64),visitKey:'b'.repeat(64),route:'home',locale:'uk'};
  await db.query('SET ROLE autohub_app');assert.equal(await SiteTrafficRepository.record(e,db),true);assert.equal(await SiteTrafficRepository.record(e,db),false);
  await SiteTrafficRepository.record({...e,id:randomUUID(),route:'catalog'},db);await SiteTrafficRepository.record({...e,id:randomUUID(),visitKey:'c'.repeat(64)},db);await SiteTrafficRepository.record({...e,id:randomUUID(),visitorKey:'d'.repeat(64),visitKey:'e'.repeat(64)},db);await db.query('RESET ROLE');
  await db.query("UPDATE site_page_views SET created_at='2026-11-18 10:00:00Z'");assert.deepEqual((await SiteTrafficRepository.dashboard('2026-11-18',db)).summary,{visitors:2,visits:3,pageViews:4});
  await assert.rejects(SiteTrafficRepository.record({...e,id:randomUUID(),route:'admin'},db),{code:'23514'});
  for(const [day,lower,upper] of [['2026-03-29','2026-03-28T22:00:00Z','2026-03-29T21:00:00Z'],['2026-10-25','2026-10-24T21:00:00Z','2026-10-25T22:00:00Z']]){
   await db.query('TRUNCATE site_page_views');for(const date of [new Date(new Date(lower)-1),new Date(lower),new Date(new Date(upper)-1),new Date(upper)])await db.query('INSERT INTO site_page_views VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),e.visitorKey,e.visitKey,'catalog','uk',date]);
   assert.equal((await SiteTrafficRepository.dashboard(day,db)).summary.pageViews,2,'23/25-hour day boundaries');
  }
  await db.query('TRUNCATE site_page_views');for(const t of ['2026-10-19T20:59:59Z','2026-10-19T21:00:00Z','2026-11-18T20:00:00Z'])await db.query('INSERT INTO site_page_views VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),e.visitorKey,e.visitKey,'home','uk',t]);
  // Exercise the actual retention service, forwarding only its site-table SQL to this isolated DB.
  const now=new Date('2026-11-18T12:00:00Z');let deleted=0,ran=false;
  const fakePool={connect:async()=>({release(){},query:async(sql,params)=>{
   if(sql.includes("to_regclass"))return {rows:[{ready:true}]};if(sql.includes('CURRENT_TIMESTAMP AS now'))return {rows:[{now}]};if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};if(sql.includes('SELECT last_completed_at'))return {rows:[]};
   if(sql.includes('DELETE FROM site_page_views')){ran=true;assert.ok(sql.includes(SITE_TRAFFIC_RETENTION_PREDICATE));const r=await db.query(sql,params);deleted+=r.rowCount;return r}
   return {rows:[],rowCount:0};
  }})};
  const result=await runDataRetention({dbPool:fakePool,dryRun:false,force:true});assert.equal(result.status,'COMPLETED');assert.equal(ran,true);assert.equal(deleted,1);assert.equal(result.deleted.site_page_views,1);assert.equal((await db.query('SELECT count(*) FROM site_page_views')).rows[0].count,'2');
 }finally{await db.end()}
});
