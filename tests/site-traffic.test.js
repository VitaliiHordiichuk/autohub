import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SiteTrafficService, normalizeSitePageView } from '../src/services/SiteTrafficService.js';
import { trafficWindow, kyivDay, shiftDay } from '../src/services/SiteTrafficPolicy.js';
import { AuthService } from '../src/services/AuthService.js';
import { siteTrafficRouter } from '../src/routes/site-traffic.routes.js';
import { adminSearchAnalyticsRouter } from '../src/routes/admin-search-analytics.routes.js';
import { requireAuth, requireRole } from '../src/middleware/auth.middleware.js';
import { SiteTrafficRepository } from '../src/repositories/SiteTrafficRepository.js';

const now=new Date('2026-11-18T22:30:00Z');
const body=()=>({eventId:randomUUID(),visitId:randomUUID(),route:'catalog',locale:'uk'});
const req=(role,ua='Mozilla/5.0')=>({auth:role?{role}:null,headers:{'x-analytics-session':'test-browser-123456','user-agent':ua}});
test('Kyiv calendar window contains exactly 30 selectable days including today',()=>{
 const w=trafficWindow(undefined,now);assert.equal(w.date,'2026-11-19');assert.equal(w.minDate,'2026-10-21');
 assert.equal(shiftDay(w.minDate,29),w.maxDate);assert.equal(kyivDay(new Date('2026-03-29T21:30:00Z')),'2026-03-30');
});
for(const date of ['2026-10-20','2026-11-20','2026-11-31','2026-02-29','hello','2026-11-18 OR 1=1'])
 test('rejects invalid, old or future date '+date,()=>assert.throws(()=>trafficWindow(date,now),{statusCode:400}));
test('accepts both window boundaries',()=>{assert.equal(trafficWindow('2026-10-21',now).date,'2026-10-21');assert.equal(trafficWindow('2026-11-19',now).date,'2026-11-19')});
test('event allowlist drops full URLs, queries, VIN and contacts',()=>{
 const b=body(),v=normalizeSitePageView({...b,url:'/uk?article=secret',email:'test@example.test',vin:'private'});
 assert.deepEqual(Object.keys(v),['id','visitId','route','locale']);assert.equal(v.route,'catalog');
});
for(const b of [null,{}, {...body(),eventId:'bad'}, {...body(),route:'admin'}, {...body(),locale:'de'}])
 test('rejects malformed page view '+JSON.stringify(b),()=>assert.throws(()=>normalizeSitePageView(b),{statusCode:400}));
test('disabled counter does not touch repository',async()=>{
 process.env.SITE_TRAFFIC_ENABLED='false';assert.equal(await SiteTrafficService.record(req(),body(),{record:()=>assert.fail()}),false);
});
test('staff, bots, prefetch and absent visitor IDs are excluded server-side',async()=>{
 process.env.SITE_TRAFFIC_ENABLED='true';
 const requests=[req('ADMIN'),req('MANAGER'),req(null,'Googlebot'),req(null,'HeadlessChrome'),{...req(),headers:{...req().headers,purpose:'prefetch'}},{headers:{}}];
 for(const r of requests)assert.equal(await SiteTrafficService.record(r,body(),{record:()=>assert.fail()}),false);
});
test('guest/client page views use only opaque hashes with stable browser and distinct session keys',async()=>{
 process.env.SITE_TRAFFIC_ENABLED='true';process.env.SEARCH_ANALYTICS_HASH_SECRET='test-only-site-traffic-secret';const events=[];const repository={record:async e=>{events.push(e);return true}};
 const b=body();assert.equal(await SiteTrafficService.record(req(),b,repository),true);await SiteTrafficService.record(req('CLIENT'),{...body(),visitId:b.visitId},repository);await SiteTrafficService.record(req(),body(),repository);
 assert.match(events[0].visitorKey,/^[a-f0-9]{64}$/);assert.equal(events[0].visitorKey,events[1].visitorKey);assert.equal(events[0].visitKey,events[1].visitKey);assert.notEqual(events[0].visitKey,events[2].visitKey);
 assert.ok(!JSON.stringify(events).includes('test-browser'));
});
test('pre-launch dates are unavailable rather than invented historical zeros',async()=>{
 process.env.SITE_TRAFFIC_ENABLED='true';const repository={dashboard:async()=>({summary:{visitors:0,visits:0,pageViews:0},startedAt:'2026-11-18T12:00:00Z'})};
 assert.equal((await SiteTrafficService.dashboard({date:'2026-11-17'},now,repository)).available,false);
 assert.equal((await SiteTrafficService.dashboard({date:'2026-11-18'},now,repository)).available,true);
});
test('actual HTTP routes enforce sessions and admin access; staff POSTs record nothing',async()=>{
 const originalAuth=AuthService.verifySessionToken,originalRecord=SiteTrafficRepository.record,originalDashboard=SiteTrafficRepository.dashboard;
 let writes=0;AuthService.verifySessionToken=async token=>{if(token==='broken')throw new Error('DB unavailable');if(token==='expired'){const e=new Error('expired');e.statusCode=401;throw e}return {role:token,mustChangePassword:false}};
 SiteTrafficRepository.record=async()=>{writes++;return true};SiteTrafficRepository.dashboard=async()=>({summary:{visitors:1,visits:2,pageViews:3},startedAt:new Date()});
 const app=express();app.use(express.json(),cookieParser());app.use('/api/analytics/site-visits',siteTrafficRouter);app.use('/api/admin',requireAuth,requireRole('ADMIN'));app.use('/api/admin/search-analytics',adminSearchAnalyticsRouter);app.use((e,r,s,n)=>s.status(503).json({success:false}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  for(const [token,status] of [['',401],['CLIENT',403],['MANAGER',403],['ADMIN',200]]){const r=await fetch(origin+'/api/admin/search-analytics/traffic',{headers:token?{Authorization:'Bearer '+token}:{}});assert.equal(r.status,status)}
  for(const [token,recorded,status] of [['',true,202],['CLIENT',true,202],['ADMIN',false,202],['MANAGER',false,202],['expired',true,202],['broken',false,503]]){
   const before=writes;const r=await fetch(origin+'/api/analytics/site-visits',{method:'POST',headers:{'Content-Type':'application/json','X-Analytics-Session':'route-test-browser-123',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body())});assert.equal(r.status,status);assert.equal(writes-before,recorded?1:0);
  }
 }finally{await new Promise(r=>server.close(r));AuthService.verifySessionToken=originalAuth;SiteTrafficRepository.record=originalRecord;SiteTrafficRepository.dashboard=originalDashboard}
});
