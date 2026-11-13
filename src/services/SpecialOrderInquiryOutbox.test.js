import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueSpecialOrderInquiryNotification,
  expandOneSpecialOrderInquiryNotification,
  claimSpecialOrderInquiryDelivery,
  finishSpecialOrderInquiryDelivery,
} from '../repositories/SpecialOrderInquiryOutboxRepository.js';
import {
  isSpecialOrderInquiryOutboxWorkerEnabled,
  processOneSpecialOrderInquiryDelivery,
  runSpecialOrderInquiryOutboxBatch,
} from './SpecialOrderInquiryOutboxScheduler.js';

test('worker is disabled by default, and requires both explicit flags', () => {
  assert.equal(isSpecialOrderInquiryOutboxWorkerEnabled({}), false);
  assert.equal(isSpecialOrderInquiryOutboxWorkerEnabled({
    MAKA_SPECIAL_ORDER_OUTBOX_WORKER_ENABLED: 'true',
    MAKA_TXT_INQUIRIES_ENABLED: 'false',
  }), false);
  assert.equal(isSpecialOrderInquiryOutboxWorkerEnabled({
    MAKA_SPECIAL_ORDER_OUTBOX_WORKER_ENABLED: 'true',
    MAKA_TXT_INQUIRIES_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: 'test-placeholder',
    BACKGROUND_JOBS_ENABLED: 'false',
  }), false);
  assert.equal(isSpecialOrderInquiryOutboxWorkerEnabled({
    MAKA_SPECIAL_ORDER_OUTBOX_WORKER_ENABLED: 'true',
    MAKA_TXT_INQUIRIES_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: 'test-placeholder',
    BACKGROUND_JOBS_ENABLED: 'true',
  }), true);
});

test('enqueue writes with the supplied transaction connection', async () => {
  let written = false;
  const db = { async query(sql, args) {
    assert.match(sql, /INSERT INTO special_order_inquiry_notification_outbox/);
    assert.deepEqual(args, [42]);
    written = true;
    return { rows: [{ id: '900' }] };
  }};
  assert.equal(await enqueueSpecialOrderInquiryNotification(42, db), '900');
  assert.equal(written, true);
  await assert.rejects(enqueueSpecialOrderInquiryNotification(0, db), /INVALID_OUTBOX/);
});

test('no eligible recipients leaves a retryable outbox event', async () => {
  const queries=[];
  const runTransaction=async callback=>callback({async query(sql,args) {
    queries.push(sql);
    if (sql.includes('FOR UPDATE SKIP LOCKED')) return {rows:[{id:19}]};
    if (sql.includes('SELECT DISTINCT c.telegram_chat_id')) return {rows:[]};
    return {rows:[]};
  }});
  const result=await expandOneSpecialOrderInquiryNotification({runTransaction});
  assert.equal(result.kind, 'NO_ELIGIBLE_STAFF');
  assert.ok(queries.some(sql=>sql.includes("INTERVAL '5 minutes'")));
  assert.equal(queries.some(sql=>sql.includes("status='EXPANDED'")),false);
});

test('claim uses a lease, max attempt limit and SKIP LOCKED', async () => {
  let n=0;
  const db={async query(sql,args){
    n++;
    if (n===1) {assert.match(sql,/LEASE_EXHAUSTED/);return{rows:[]};}
    assert.match(sql,/SKIP LOCKED/);
    assert.match(sql,/120 seconds/);
    assert.equal(args[0],8);
    return {rows:[]};
  }};
  assert.equal(await claimSpecialOrderInquiryDelivery(db),null);
});

test('successful mock delivery is recorded, without Telegram API call', async () => {
  const calls=[];
  const event={id:22,article:'HU7185X',quantity:1,estimatedUnitPriceUah:950,
    contactName:'Test',contactPhone:'+380671234567',source:'WEBSITE'};
  const result=await processOneSpecialOrderInquiryDelivery({
    claim:async()=>({id:3,claim_token:'token',telegram_chat_id:'mock-chat'}),
    load:async()=>({stillAuthorized:true,event}),
    transport:async(chat,payload)=>{calls.push({chat,payload});},
    finish:async(_delivery,outcome)=>{calls.push(outcome);},
  });
  assert.equal(result,'SENT');
  assert.equal(calls[0].chat,'mock-chat');
  assert.match(calls[0].payload.text,/HU7185X/);
  assert.equal(calls[1],'SENT');
});

test('removed staff and closed inquiries are skipped', async () => {
  const states=[];
  const result=await processOneSpecialOrderInquiryDelivery({
    claim:async()=>({id:3,claim_token:'token',telegram_chat_id:'mock-chat'}),
    load:async()=>({stillAuthorized:false}),
    transport:async()=>{throw Error('must not send');},
    finish:async(_delivery,outcome)=>{states.push(outcome);},
  });
  assert.equal(result,'SKIPPED');
  assert.deepEqual(states,['SKIPPED']);
});

test('failed sends are made retryable', async () => {
  const states=[];
  const original=console.error;
  console.error=()=>{};
  try {
    const outcome=await processOneSpecialOrderInquiryDelivery({
      claim:async()=>({id:3,claim_token:'token',telegram_chat_id:'mock-chat'}),
      load:async()=>({stillAuthorized:true,event:{id:1,article:'HU7185X',quantity:1,
        estimatedUnitPriceUah:950,contactPhone:'+380671234567',source:'WEBSITE'}}),
      transport:async()=>{throw Error('network unavailable');},
      finish:async(_delivery,state)=>{states.push(state);},
    });
    assert.equal(outcome,'RETRY');
    assert.deepEqual(states,['RETRY']);
  } finally {console.error=original;}
});

test('batch bounds processed work', async () => {
  let expansions=0,deliveries=0;
  await runSpecialOrderInquiryOutboxBatch({
    expand:async()=>{expansions++;return{kind:'EXPANDED'};},
    process:async()=>{deliveries++;return 'SENT';},
  });
  assert.equal(expansions,5);
  assert.equal(deliveries,10);
});

test('finish requires a matching claim and records success',async()=>{
  let called=false;
  const db={async query(sql,args){
    assert.match(sql,/claim_token=\$2::uuid/);
    assert.equal(args[2],'SENT');
    called=true;
    return{rows:[{status:'SENT'}]};
  }};
  assert.equal(await finishSpecialOrderInquiryDelivery({id:1,claim_token:'2d1c045b-bf12-4263-af79-2adc83b615fd'},'SENT',db),'SENT');
  assert.equal(called,true);
});
