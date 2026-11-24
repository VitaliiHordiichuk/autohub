import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { claimVinTelegramDelivery, loadVinTelegramDelivery, finishVinTelegramDelivery } from '../src/repositories/VinTelegramDeliveryRepository.js';
import { processOneVinTelegramDelivery } from '../src/services/VinTelegramDeliveryScheduler.js';

const socket = process.env.MAKA_VIN_PG_TEST_SOCKET;
const enabled = typeof socket === 'string' && socket.startsWith('/private/tmp/maka-vin-telegram-');
let db;
before(async () => {
  if (!enabled) return;
  db = new pg.Pool({ host: socket, port: 55439, user: 'maka_vin_test', database: 'postgres', options: '-c search_path=vin_delivery_test' });
  await db.query(`CREATE SCHEMA vin_delivery_test;
    CREATE TABLE users(id integer PRIMARY KEY,is_active boolean,first_name text,last_name text,email text,phone text);
    CREATE TABLE employee_profiles(user_id integer PRIMARY KEY,staff_role text,access_enabled boolean,telegram_allowed boolean,order_notifications_enabled boolean,removed_at timestamp);
    CREATE TABLE makatron_staff_links(user_id integer PRIMARY KEY,telegram_chat_id bigint,telegram_user_id bigint,notifications_enabled boolean);
    CREATE TABLE telegram_bot_locales(chat_id bigint PRIMARY KEY,locale text);
    CREATE TABLE vehicle_brands(id integer PRIMARY KEY,name text);
    CREATE TABLE vin_requests(id bigint PRIMARY KEY,user_id integer,vehicle_brand_id integer,vin text,request_text text,contact_phone text,guest_name text,status text);
    CREATE TABLE vin_request_messages(id bigint PRIMARY KEY,vin_request_id bigint,sender_user_id integer,sender_role text,message text);
    CREATE TABLE user_notifications(id bigserial PRIMARY KEY,user_id integer,event_key text,type text,payload jsonb,read_at timestamp,created_at timestamp NOT NULL DEFAULT NOW());`);
});
after(async () => { if (db) { await db.query('DROP SCHEMA vin_delivery_test CASCADE'); await db.end(); } });
const marker = (event = 'NEW_REQUEST', extra = {}) => ({ version: 1, event, status: 'PENDING', attempts: 0, ...extra });
async function seed() {
  await db.query(`TRUNCATE users,employee_profiles,makatron_staff_links,telegram_bot_locales,vehicle_brands,vin_requests,vin_request_messages,user_notifications RESTART IDENTITY;
    INSERT INTO users VALUES(2,TRUE,'Admin',NULL,NULL,NULL),(6,TRUE,'Manager',NULL,NULL,NULL),(31,TRUE,'Тест','Клієнт','test@example.test','+380000000000');
    INSERT INTO employee_profiles VALUES(2,'ADMIN',TRUE,TRUE,TRUE,NULL),(6,'MANAGER',TRUE,TRUE,TRUE,NULL);
    INSERT INTO makatron_staff_links VALUES(2,10001,10001,TRUE),(6,10002,10002,TRUE);
    INSERT INTO telegram_bot_locales VALUES(10001,'uk'),(10002,'ru');
    INSERT INTO vehicle_brands VALUES(1,'Mercedes-Benz');
    INSERT INTO vin_requests VALUES(42,31,1,'WDD2120471A387679','Потрібні <колодки>','+380000000000',NULL,'NEW');`);
}
async function enqueue(userId = 2, state = marker(), overrides = {}) {
  const payload = { vinRequestId: 42, vin: 'WDD2120471A387679', ...(state ? { telegramVin: state } : {}) };
  const result = await db.query(`INSERT INTO user_notifications(user_id,event_key,type,payload,read_at,created_at)
    VALUES($1,$2,$3,$4::jsonb,$5,COALESCE($6::timestamp,NOW())) RETURNING id::text AS id`,
  [userId, `vin:42:${state?.event === 'CLIENT_MESSAGE' ? `client-message:${state.messageId}` : 'new'}:${userId}`, overrides.type || (state?.event === 'CLIENT_MESSAGE' ? 'VIN_REQUEST_UPDATED' : 'VIN_REQUEST_NEW'), JSON.stringify(payload), overrides.readAt || null, overrides.createdAt || null]);
  return result.rows[0].id;
}
async function deliverOne(transport) {
  return processOneVinTelegramDelivery({ claim: () => claimVinTelegramDelivery(db), load: delivery => loadVinTelegramDelivery(delivery, db), finish: (delivery, outcome) => finishVinTelegramDelivery(delivery, outcome, db), transport, frontendUrl: 'https://maka.com.ua', logger: { error() {} } });
}
const check = (name, fn) => test(name, { skip: !enabled }, fn);

check('real SQL delivers to staff links only, once per admin and manager, even if notification already read', async () => {
  await seed(); await enqueue(2, marker(), { readAt: '2026-11-24T00:00:00' }); await enqueue(6);
  const sent = [];
  const transport = async (chat, message) => sent.push({ chat, message });
  assert.equal(await deliverOne(transport), 'SENT'); assert.equal(await deliverOne(transport), 'SENT');
  assert.equal(await deliverOne(transport), 'EMPTY');
  assert.deepEqual(sent.map(item => item.chat), ['10001','10002']);
  assert.match(sent[0].message.text, /Новий VIN-запит/);
  assert.match(sent[1].message.text, /Новый VIN-запрос/);
  assert.match(sent[0].message.text, /&lt;колодки&gt;/);
  assert.equal(sent[0].message.reply_markup.inline_keyboard[0][0].url, 'https://maka.com.ua/uk/admin/vin-requests?request=42');
  assert.equal((await db.query(`SELECT COUNT(*)::integer AS n FROM user_notifications WHERE payload#>>'{telegramVin,status}'='SENT'`)).rows[0].n, 2);
});

check('historical markerless events and unrelated notifications never enter the queue', async () => {
  await seed(); await enqueue(2, null); await enqueue(6, marker(), { type: 'ORDER_CREATED' });
  assert.equal(await claimVinTelegramDelivery(db), null);
});

check('guest VIN contains contact and request while shared staff chat receives only one copy', async () => {
  await seed(); await db.query(`UPDATE vin_requests SET user_id=NULL,guest_name='Гість'; UPDATE makatron_staff_links SET telegram_chat_id=10001,telegram_user_id=10001 WHERE user_id=6`);
  await enqueue(2); await enqueue(6);
  const sent=[]; const transport=async (chat, message) => sent.push({chat,message});
  assert.equal(await deliverOne(transport),'SENT'); assert.equal(await deliverOne(transport),'SKIPPED');
  assert.equal(sent.length,1); assert.match(sent[0].message.text,/Гість/); assert.match(sent[0].message.text,/WDD2120471A387679/);
});

check('concurrent claims have different row IDs; expired lease is reclaimed and old owner cannot finish', async () => {
  await seed(); await enqueue(2); await enqueue(6);
  const [first, second]=await Promise.all([claimVinTelegramDelivery(db),claimVinTelegramDelivery(db)]);
  assert.notEqual(first.id,second.id);
  await db.query(`UPDATE user_notifications SET payload=jsonb_set(payload,'{telegramVin,leaseUntil}','0') WHERE id=$1`,[first.id]);
  const reclaimed=await claimVinTelegramDelivery(db); assert.equal(reclaimed.id,first.id); assert.notEqual(reclaimed.claimToken,first.claimToken);
  await assert.rejects(finishVinTelegramDelivery(first,'SENT',db),/CLAIM_LOST/);
  await finishVinTelegramDelivery({...reclaimed,chatId:'10001'},'SENT',db);
});

check('transport failure retries with bounded delay and preserves unrelated payload fields', async () => {
  await seed(); const id=await enqueue();
  assert.equal(await deliverOne(async () => { throw new Error('network error'); }),'RETRY');
  const row=(await db.query('SELECT payload FROM user_notifications WHERE id=$1',[id])).rows[0];
  assert.equal(row.payload.vin,'WDD2120471A387679'); assert.equal(row.payload.telegramVin.status,'PENDING'); assert.equal(row.payload.telegramVin.attempts,1);
  assert.ok(row.payload.telegramVin.nextAttemptAt > Date.now()/1000);
  assert.equal(await claimVinTelegramDelivery(db),null);
  await db.query(`UPDATE user_notifications SET payload=jsonb_set(payload,'{telegramVin,nextAttemptAt}','0') WHERE id=$1`,[id]);
  assert.equal(await deliverOne(async () => {}),'SENT');
});

check('disabled, removed, inactive, nonstaff, muted and nonprivate recipients are excluded at send time', async () => {
  for (const change of [
    `UPDATE employee_profiles SET access_enabled=FALSE WHERE user_id=2`,
    `UPDATE employee_profiles SET removed_at=NOW() WHERE user_id=2`,
    `UPDATE users SET is_active=FALSE WHERE id=2`,
    `UPDATE employee_profiles SET staff_role='CLIENT' WHERE user_id=2`,
    `UPDATE employee_profiles SET telegram_allowed=FALSE WHERE user_id=2`,
    `UPDATE makatron_staff_links SET notifications_enabled=FALSE WHERE user_id=2`,
    `UPDATE makatron_staff_links SET telegram_chat_id=-10099 WHERE user_id=2`,
    `DELETE FROM makatron_staff_links WHERE user_id=2`,
  ]) {
    await seed(); await enqueue(); await db.query(change);
    assert.equal(await deliverOne(async () => { assert.fail('must not send'); }),'SKIPPED');
  }
});

check('reply uses exact bigint message identity and rejects foreign or staff messages', async () => {
  await seed();
  await db.query(`INSERT INTO vin_request_messages VALUES(9007199254740993,42,31,'CLIENT','Уточнення <деталі>')`);
  await enqueue(2,marker('CLIENT_MESSAGE',{messageId:'9007199254740993'}));
  const sent=[]; assert.equal(await deliverOne(async (_chat,msg) => sent.push(msg)),'SENT'); assert.match(sent[0].text,/Уточнення &lt;деталі&gt;/);
  for (const change of [`UPDATE vin_request_messages SET vin_request_id=99`,`UPDATE vin_request_messages SET sender_role='ADMIN'`,`UPDATE vin_request_messages SET sender_user_id=6`]) {
    await seed(); await db.query(`INSERT INTO vin_request_messages VALUES(9007199254740993,42,31,'CLIENT','Чужий текст')`); await enqueue(2,marker('CLIENT_MESSAGE',{messageId:'9007199254740993'})); await db.query(change);
    assert.equal(await deliverOne(async () => { assert.fail('must not send'); }),'SKIPPED');
  }
});

check('old events and exhausted leases become terminal without sending', async () => {
  for (const [state,overrides] of [[marker(),{createdAt:'2020-01-01'}],[marker('NEW_REQUEST',{attempts:8}),{}],[marker('NEW_REQUEST',{attempts:8,status:'IN_FLIGHT',leaseUntil:0}),{}]]) {
    await seed(); const id=await enqueue(2,state,overrides);
    assert.equal(await deliverOne(async () => { assert.fail('must not send'); }),'FAILED');
    assert.equal((await db.query('SELECT payload FROM user_notifications WHERE id=$1',[id])).rows[0].payload.telegramVin.status,'FAILED');
    assert.equal(await claimVinTelegramDelivery(db),null);
  }
});
