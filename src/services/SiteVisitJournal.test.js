import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import cookieParser from 'cookie-parser';
import {SiteTrafficService,normalizeSitePageView} from './SiteTrafficService.js';
import {SiteTrafficRepository} from '../repositories/SiteTrafficRepository.js';
import {trafficArticle,trafficPagePath,trafficDevice,journalPage} from './SiteVisitContext.js';
import {SITE_TRAFFIC_RETENTION_PREDICATE,trafficWindow} from './SiteTrafficPolicy.js';
import {AuthService} from './AuthService.js';
import {requireAuth,requireRole} from '../middleware/auth.middleware.js';
import {adminSearchAnalyticsRouter} from '../routes/admin-search-analytics.routes.js';

const url=process.env.SITE_JOURNAL_TEST_DATABASE_URL;
assert.ok(url,'Use a disposable local database for this suite');
const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.port,'55439');
const db=new pg.Pool({connectionString:url,max:1});
const schema=`journal_test_${process.pid}`;
const now=new Date('2026-11-20T12:00:00Z'), day='2026-11-20';
const visitor='a'.repeat(64),visit='b'.repeat(64);
const input=()=>({eventId:randomUUID(),visitId:randomUUID(),route:'home',locale:'uk',pagePath:'/uk'});
const repo={record:e=>SiteTrafficRepository.record(e,db),dashboard:d=>SiteTrafficRepository.dashboard(d,db),journal:(d,p)=>SiteTrafficRepository.journal(d,p,db),visitEvents:(d,k,p)=>SiteTrafficRepository.visitEvents(d,k,p,db)};
async function event({id=randomUUID(),visitorKey=visitor,visitKey=visit,route='home',locale='uk',deviceType='phone',pagePath='/uk',article=null,time='2026-11-20T12:00:00Z'}={}) {
 await SiteTrafficRepository.record({id,visitorKey,visitKey,route,locale,deviceType,pagePath,article},db);
 await db.query('UPDATE site_page_views SET created_at=$2 WHERE id=$1',[id,time]);return id;
}
before(async()=>{
 process.env.SITE_TRAFFIC_ENABLED='true';
 await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET search_path TO ${schema}`);
 await db.query(`CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,executed_at TIMESTAMP NOT NULL);
 INSERT INTO schema_migrations VALUES('133_create_site_traffic','2026-11-18 08:00:00');
 CREATE TABLE site_page_views(id UUID PRIMARY KEY,visitor_key CHAR(64) NOT NULL,visit_key CHAR(64) NOT NULL,
 route VARCHAR(24) NOT NULL,locale VARCHAR(2) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX ON site_page_views(visit_key,created_at);
 CREATE TABLE products(id INTEGER PRIMARY KEY,article_normalized TEXT,name TEXT,is_active BOOLEAN NOT NULL);
 INSERT INTO products VALUES(1,'A9062700501','Піддон КПП',TRUE);`);
 await db.query('INSERT INTO site_page_views(id,visitor_key,visit_key,route,locale) VALUES($1,$2,$3,$4,$5)',[randomUUID(),visitor,visit,'home','uk']);
 const migration=await fs.readFile(new URL('../../migrations/135_site_visit_journal.sql',import.meta.url),'utf8');
 await db.query(migration);await db.query(migration);
 const prior=(await db.query('SELECT * FROM site_page_views')).rows;assert.equal(prior.length,1);assert.equal(prior[0].device_type,'unknown');assert.equal(prior[0].page_path,null);
});
beforeEach(()=>db.query('TRUNCATE site_page_views'));
after(async()=>{await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();});

test('migration is repeatable and existing-style rows stay unknown',async()=>{
 const id=randomUUID();await db.query('INSERT INTO site_page_views(id,visitor_key,visit_key,route,locale) VALUES($1,$2,$3,$4,$5)',[id,visitor,visit,'home','uk']);
 const row=(await db.query('SELECT * FROM site_page_views WHERE id=$1',[id])).rows[0];
 assert.equal(row.device_type,'unknown');assert.equal(row.page_path,null);assert.equal(row.page_article,null);
 assert.equal((await db.query("SELECT COUNT(*) FROM schema_migrations WHERE version='135_site_visit_journal'")).rows[0].count,'1');
});
test('unsafe paths, personal query parameters and account IDs are not retained',()=>{
 for(const p of ['https://evil.test/uk','//evil.test/uk','/uk/../admin','/uk/account?token=secret','/uk/reset-password#secret','/ru/cart','/uk/%2e%2e/admin'])assert.equal(trafficPagePath(p,'account','uk'),null,p);
 assert.equal(trafficPagePath('/uk/account/orders/57','account','uk'),'/uk/account/orders');
 assert.equal(trafficPagePath('/uk/reset-password/secret','reset-password','uk'),'/uk/reset-password');
 assert.equal(trafficPagePath('/uk/vin-request','vin-request','uk'),'/uk/vin-request');
 assert.equal(trafficArticle('client@example.com'),null);assert.equal(trafficArticle('hello 123\nsecret'),null);
 assert.equal(trafficArticle('а 222-270-05-12'),'A2222700512');
 const p=normalizeSitePageView({...input(),route:'product',pagePath:'/uk/product/A9062700501',article:'A2222700512',email:'private@example.test'});
 assert.equal(p.article,'A9062700501');assert.equal(p.email,undefined);
});
test('device types are broad categories and old clients remain compatible',()=>{
 assert.equal(trafficDevice('Mozilla iPhone Mobile'),'phone');assert.equal(trafficDevice('Mozilla Android Mobile'),'phone');
 assert.equal(trafficDevice('Mozilla iPad'),'tablet');assert.equal(trafficDevice('Mozilla Android'),'tablet');
 assert.equal(trafficDevice('Mozilla Macintosh','tablet'),'tablet');assert.equal(trafficDevice('Mozilla Windows','invalid'),'desktop');assert.equal(trafficDevice(''),'unknown');
 const e=input();delete e.pagePath;const p=normalizeSitePageView(e);assert.equal(p.pagePath,null);assert.equal(p.article,null);
});
test('staff, recognised bots, prefetches and absent visitor IDs never add rows',async()=>{
 for(const req of [{auth:{role:'ADMIN'}},{auth:{role:'MANAGER'}},{headers:{'user-agent':'Googlebot'}},{headers:{'sec-purpose':'prefetch'}},{headers:{}}]) {
  let called=false;const headers={'x-analytics-session':randomUUID(),...req.headers};
  if(!req.auth&&!Object.keys(req.headers||{}).length)delete headers['x-analytics-session'];
  assert.equal(await SiteTrafficService.record({...req,headers},input(),{record:async()=>{called=true;return true;}}),false);
  assert.equal(called,false);
 }
});
test('service stores the classified event and duplicate event IDs are idempotent',async()=>{
 const req={headers:{'x-analytics-session':randomUUID(),'user-agent':'Mozilla iPhone Mobile'}},body={...input(),route:'product',pagePath:'/uk/product/A9062700501',article:'A9062700501'};
 assert.equal(await SiteTrafficService.record(req,body,repo),true);assert.equal(await SiteTrafficService.record(req,body,repo),false);
 const row=(await db.query('SELECT * FROM site_page_views')).rows[0];assert.equal(row.device_type,'phone');assert.equal(row.page_article,'A9062700501');assert.match(row.visitor_key,/^[a-f0-9]{64}$/);assert.equal(row.user_agent,undefined);
});
test('visit journal groups pages, keeps visits separate and shows chronological product details',async()=>{
 await event({route:'home',time:'2026-11-20T12:00:00Z'});
 await event({route:'product',pagePath:'/uk/product/A9062700501',article:'A9062700501',time:'2026-11-20T12:01:00Z'});
 await event({visitKey:'c'.repeat(64),deviceType:'desktop',time:'2026-11-20T14:00:00Z'});
 await event({visitKey:'d'.repeat(64),time:'2026-11-19T12:00:00Z'});
 const result=await SiteTrafficService.dashboard({date:day},now,repo);assert.deepEqual(result.summary,{visitors:1,visits:2,pageViews:3});assert.equal(result.journal.items.length,2);assert.equal(result.journal.items[0].deviceType,'desktop');assert.ok(result.journalStartedAt);
 const details=await SiteTrafficService.visitEvents(visit,{date:day},now,repo);assert.equal(details.total,2);assert.deepEqual(details.items.map(e=>e.route),['home','product']);assert.equal(details.items[1].productName,'Піддон КПП');assert.equal(details.items[0].createdAt,'2026-11-20T12:00:00.000Z');
 await assert.rejects(SiteTrafficService.visitEvents(visit,{date:'2026-11-19'},now,repo),e=>e.statusCode===404);
});
test('legacy visit details do not invent a device or a product',async()=>{
 await event({deviceType:'unknown',pagePath:null,route:'product'});
 const details=await SiteTrafficService.visitEvents(visit,{date:day},now,repo);assert.equal(details.visit.deviceType,'unknown');assert.equal(details.items[0].pagePath,null);assert.equal(details.items[0].productName,null);
});
test('visit list and event history are paginated without missing rows at identical timestamps',async()=>{
 for(let n=0;n<27;n++)await event({visitKey:n.toString(16).padStart(64,'0')});
 let d=await SiteTrafficService.dashboard({date:day,page:'2'},now,repo);assert.equal(d.journal.items.length,2);assert.equal(d.journal.total,27);assert.equal(d.journal.pages,2);
 d=await SiteTrafficService.dashboard({date:day,page:'99'},now,repo);assert.equal(d.journal.page,2);
 await db.query('TRUNCATE site_page_views');for(let n=0;n<103;n++)await event();
 const a=await SiteTrafficService.visitEvents(visit,{date:day},now,repo),b=await SiteTrafficService.visitEvents(visit,{date:day,page:'2'},now,repo);
 assert.equal(a.items.length,100);assert.equal(b.items.length,3);assert.equal(new Set([...a.items,...b.items].map(e=>e.id)).size,103);assert.equal(b.pages,2);
});
test('Kyiv day boundaries and retention preserve exactly the latest 30 calendar days',async()=>{
 await event({time:'2026-11-19T21:59:59Z'});await event({time:'2026-11-19T22:00:00Z'});await event({time:'2026-11-20T21:59:59Z'});await event({time:'2026-11-20T22:00:00Z'});
 assert.equal((await SiteTrafficRepository.dashboard(day,db)).summary.pageViews,2);
 await db.query('TRUNCATE site_page_views');await event({time:'2026-10-21T20:59:59Z'});await event({time:'2026-10-21T21:00:00Z'});
 const result=await db.query(`DELETE FROM site_page_views t WHERE ${SITE_TRAFFIC_RETENTION_PREDICATE}`,[now.toISOString()]);assert.equal(result.rowCount,1);
 for(const d of ['2026-03-29','2026-10-25']) {
  const r=await db.query("SELECT EXTRACT(EPOCH FROM ((($1::date+1)::timestamp AT TIME ZONE 'Europe/Kyiv')-($1::date::timestamp AT TIME ZONE 'Europe/Kyiv')))/3600 AS hours",[d]);assert.equal(Number(r.rows[0].hours),d.includes('03')?23:25);
 }
});
test('date, visit key and pagination validation reject invalid or expired history',async()=>{
 for(const date of ['2026-10-21','2026-11-21','2026-02-30',"2026-11-20' OR 1=1 --"])assert.throws(()=>trafficWindow(date,now));
 for(const p of ['-1','1.5','x','10001'])assert.throws(()=>journalPage(p));
 await assert.rejects(SiteTrafficService.visitEvents('not-a-key',{date:day},now,repo),e=>e.statusCode===400);
 await assert.rejects(SiteTrafficService.visitEvents(visit,{date:day,page:'201'},now,repo),e=>e.statusCode===400);
});
test('journal endpoints are available only to an authenticated administrator',async t=>{
 t.mock.method(AuthService,'verifySessionToken',async token=>({userId:1,role:token}));
 t.mock.method(SiteTrafficService,'dashboard',async()=>({summary:{visits:0}}));
 t.mock.method(SiteTrafficService,'visitEvents',async()=>({items:[]}));
 const app=express();app.use(cookieParser());app.use('/api/admin',requireAuth,requireRole('ADMIN'));app.use('/api/admin/search-analytics',adminSearchAnalyticsRouter);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 for(const tail of ['/traffic',`/traffic/visits/${visit}`])for(const [role,status] of [[null,401],['MANAGER',403],['CLIENT',403],['ADMIN',200]]) {
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/search-analytics${tail}`,{headers:role?{Authorization:`Bearer ${role}`}:{}});assert.equal(r.status,status);
  if(status===200)assert.equal(r.headers.get('cache-control'),'private, no-store');
 }
});
