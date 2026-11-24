import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VIN_TELEGRAM_SQL, claimVinTelegramDelivery,
  loadVinTelegramDelivery, finishVinTelegramDelivery,
} from './VinTelegramDeliveryRepository.js';

const token = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const delivery = { id: '9007199254740993', claimToken: token, attempts: 1, status: 'IN_FLIGHT' };
function sourceRow(overrides = {}) {
  return {
    notification_id: delivery.id, user_id: 2, canonical_user_id: 2,
    notification_type: 'VIN_REQUEST_NEW',
    payload: { vinRequestId: '42', telegramVin: { version: 1, event: 'NEW_REQUEST', status: 'IN_FLIGHT' } },
    request_id: '42', request_status: 'NEW', telegram_chat_id: '100001',
    still_authorized: true, already_sent: false, preferred_locale: 'uk',
    vin: 'WDD2120471A387679', request_text: 'Потрібні колодки', guest_name: 'Гість',
    contact_phone: '+380671234567', vehicle_brand_name: 'Mercedes-Benz',
    ...overrides,
  };
}
function dbWithRows(rows) {
  const calls = [];
  return { calls, async query(sql, args) { calls.push({ sql, args }); return { rows }; } };
}

test('claims retain bigint notification IDs exactly and distinguish exhausted work', async () => {
  const db = dbWithRows([{ id: delivery.id, claim_token: token, attempts: 2, status: 'IN_FLIGHT' }]);
  assert.deepEqual(await claimVinTelegramDelivery(db), { ...delivery, attempts: 2 });
  assert.match(db.calls[0].args[0], /^[a-f0-9-]{36}$/);
  assert.equal(await claimVinTelegramDelivery(dbWithRows([])), null);
  assert.equal((await claimVinTelegramDelivery(dbWithRows([
    { id: delivery.id, claim_token: null, attempts: 8, status: 'FAILED' },
  ]))).status, 'FAILED');
});

test('loads the private staff recipient without rounding the claim or falling back to client identity', async () => {
  const db = dbWithRows([sourceRow({ preferred_locale: 'ru' })]);
  const result = await loadVinTelegramDelivery(delivery, db);
  assert.equal(result.stillAuthorized, true);
  assert.equal(result.request.id, '42');
  assert.equal(result.chatId, '100001');
  assert.equal(result.locale, 'ru');
  assert.equal(result.request.guest_name, 'Гість');
  assert.deepEqual(db.calls[0].args, [delivery.id, token]);
  assert.equal(db.calls[0].sql, VIN_TELEGRAM_SQL.load);
});

test('authorization loss, shared-chat duplicates, missing/deleted requests and bad marker IDs fail closed', async () => {
  const badRows = [
    sourceRow({ still_authorized: false }),
    sourceRow({ still_authorized: null }),
    sourceRow({ already_sent: true }),
    sourceRow({ canonical_user_id: 1 }),
    sourceRow({ request_id: null }),
    sourceRow({ request_id: '9007199254740993' }),
    sourceRow({ telegram_chat_id: '-100001' }),
    sourceRow({ telegram_chat_id: 'not-an-id' }),
    sourceRow({ request_status: 'CLOSED' }),
    sourceRow({ notification_type: 'ORDER_NEW' }),
    sourceRow({ payload: { vinRequestId: '43', telegramVin: { version: 1, event: 'NEW_REQUEST' } } }),
    sourceRow({ payload: { vinRequestId: '42', telegramVin: { version: 2, event: 'NEW_REQUEST' } } }),
    sourceRow({ payload: {} }),
  ];
  for (const row of badRows) {
    assert.deepEqual(await loadVinTelegramDelivery(delivery, dbWithRows([row])), { stillAuthorized: false });
  }
});

test('client reply requires the exact source message and event, rather than the request initial text', async () => {
  const row = sourceRow({
    notification_type: 'VIN_REQUEST_UPDATED', message_id: '9007199254740995',
    client_message: 'Ще потрібен фільтр', preferred_locale: 'en',
    payload: { vinRequestId: '42', telegramVin: { version: 1, event: 'CLIENT_MESSAGE', messageId: '9007199254740995' } },
  });
  const result = await loadVinTelegramDelivery(delivery, dbWithRows([row]));
  assert.equal(result.event, 'CLIENT_MESSAGE');
  assert.equal(result.message, 'Ще потрібен фільтр');
  assert.equal(result.locale, 'en');
  for (const modified of [{ ...row, message_id: null }, { ...row, message_id: '123' }, { ...row, client_message: '' }, { ...row, notification_type: 'VIN_REQUEST_NEW' }]) {
    assert.deepEqual(await loadVinTelegramDelivery(delivery, dbWithRows([modified])), { stillAuthorized: false });
  }
});

test('deleted or reclaimed leases return null and cannot be mistaken for authorized recipients', async () => {
  assert.equal(await loadVinTelegramDelivery(delivery, dbWithRows([])), null);
  await assert.rejects(finishVinTelegramDelivery(delivery, 'SENT', dbWithRows([])), /VIN_DELIVERY_CLAIM_LOST/);
});

test('completion is parameterized, lease-scoped, and records the exact chat for durable dedup', async () => {
  const db = dbWithRows([{ status: 'SENT' }]);
  assert.equal(await finishVinTelegramDelivery({ ...delivery, chatId: '9007199254740997' }, 'SENT', db), 'SENT');
  assert.deepEqual(db.calls[0].args, [delivery.id, token, 'SENT', '9007199254740997']);
  assert.equal(db.calls[0].sql, VIN_TELEGRAM_SQL.finish);
});

test('invalid or unsafe identifiers never reach SQL', async () => {
  const db = { async query() { throw new Error('MUST_NOT_QUERY'); } };
  for (const bad of [0, -1, 9007199254740992, '1 OR 1=1', '01', '9223372036854775808']) {
    await assert.rejects(loadVinTelegramDelivery({ ...delivery, id: bad }, db), /INVALID_VIN_DELIVERY_CLAIM/);
  }
  await assert.rejects(loadVinTelegramDelivery({ ...delivery, claimToken: 'bad' }, db), /INVALID_VIN_DELIVERY_CLAIM/);
  await assert.rejects(finishVinTelegramDelivery(delivery, 'UNTRUSTED', db), /INVALID_VIN_DELIVERY_OUTCOME/);
  await assert.rejects(finishVinTelegramDelivery({ ...delivery, chatId: -1 }, 'SENT', db), /INVALID_VIN_DELIVERY_CHAT/);
});
