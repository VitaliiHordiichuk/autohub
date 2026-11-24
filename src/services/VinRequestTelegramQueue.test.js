import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../config/db.js';
import { VinRequestService } from './VinRequestService.js';
import { VinRequestRepository } from '../repositories/VinRequestRepository.js';
import { NotificationRepository } from '../repositories/NotificationRepository.js';
import { CustomerPricingService } from './CustomerPricingService.js';
import { TelegramNotificationService } from './TelegramNotificationService.js';

const input = { userId: 31, vehicleBrandId: 1, vin: 'WDD2120471A387679', requestText: 'Потрібні передні колодки', contactPhone: '+380671234567' };

async function scenario({ kind = 'registered', fail = null } = {}) {
  const restores = [];
  const patch = (object, key, fn) => { const previous = object[key]; object[key] = fn; restores.push(() => { object[key] = previous; }); };
  const committed = [], staged = [], sql = [];
  let networkCalls = 0;
  const row = { id: '42', user_id: 31, status: 'NEW', vin: input.vin, request_text: input.requestText, created_at: '2026-11-24T10:00:00Z', recommendations: [] };
  const db = {
    async query(text) {
      sql.push(text);
      if (text === 'BEGIN') staged.length = 0;
      if (text === 'COMMIT') committed.push(...staged);
      if (text === 'ROLLBACK') staged.length = 0;
      return { rows: [] };
    },
    release() { sql.push('RELEASE'); },
  };
  patch(pool, 'connect', async () => db);
  patch(VinRequestRepository, 'phoneVerificationStatus', async () => ({ role_name: 'CLIENT', phone: input.contactPhone, verified: true }));
  patch(VinRequestRepository, 'settings', async () => ({ mode: 'CHAT' }));
  patch(VinRequestRepository, 'supportedBrand', async () => ({ id: 1, name: 'Mercedes-Benz' }));
  patch(VinRequestRepository, 'createStats', async () => ({ duplicate_count: 0, hour_count: 0, day_count: 0 }));
  patch(VinRequestRepository, 'guestCreateStats', async () => ({ duplicate_count: 0, hour_count: 0, day_count: 0 }));
  patch(VinRequestRepository, 'create', async (_values, transactionDb) => {
    assert.equal(transactionDb, db);
    if (fail === 'create') throw new Error('create failed');
    return row;
  });
  patch(VinRequestRepository, 'createGuest', async (_values, transactionDb) => {
    assert.equal(transactionDb, db);
    return { ...row, user_id: null };
  });
  patch(VinRequestRepository, 'findForUser', async () => row);
  patch(VinRequestRepository, 'clientMessageStats', async () => ({ duplicate_count: 0, hour_count: 0, day_count: 0 }));
  patch(VinRequestRepository, 'addMessage', async (_values, transactionDb) => {
    assert.equal(transactionDb, db);
    return { id: '9007199254740993' };
  });
  patch(VinRequestRepository, 'touchAfterClientMessage', async () => {});
  patch(CustomerPricingService, 'getContext', async () => ({}));
  patch(NotificationRepository, 'createForStaff', async (notification, transactionDb) => {
    assert.equal(transactionDb, db);
    assert.equal(committed.length, 0, 'delivery is not visible before commit');
    staged.push(notification);
    if (fail === 'notification') throw new Error('notification failed');
    return [];
  });
  patch(TelegramNotificationService, 'sendVinActivityToStaff', async () => { networkCalls++; });
  try {
    let error;
    try {
      if (kind === 'guest') await VinRequestService.createGuest({ ...input, guestName: 'Тест' });
      else if (kind === 'reply') await VinRequestService.addClientMessage({ requestId: 42, userId: 31, message: 'Уточнення запиту' });
      else await VinRequestService.create(input);
    } catch (caught) { error = caught; }
    return { committed, sql, networkCalls, error };
  } finally { restores.reverse().forEach(restore => restore()); }
}

for (const kind of ['registered', 'guest', 'reply']) {
  test(`${kind} VIN event is queued in the transaction with no direct API Telegram send`, async () => {
    const result = await scenario({ kind });
    assert.equal(result.error, undefined);
    assert.equal(result.committed.length, 1);
    const notification = result.committed[0];
    assert.equal(notification.payload.vinRequestId, 42);
    assert.equal(notification.payload.vin, input.vin);
    assert.deepEqual(notification.payload.telegramVin, {
      version: 1, event: kind === 'reply' ? 'CLIENT_MESSAGE' : 'NEW_REQUEST',
      ...(kind === 'reply' ? { messageId: '9007199254740993' } : {}),
      status: 'PENDING', attempts: 0,
    });
    if (kind === 'guest') assert.equal(notification.payload.guest, true);
    if (kind === 'reply') assert.equal(notification.payload.status, 'IN_PROGRESS');
    assert.equal(result.networkCalls, 0);
    assert.ok(result.sql.includes('COMMIT'));
  });
}

for (const kind of ['registered', 'guest', 'reply']) {
  test(`${kind} VIN rollback cannot leave a queued Telegram delivery`, async () => {
    const result = await scenario({ kind, fail: 'notification' });
    assert.match(result.error.message, /notification failed/);
    assert.deepEqual(result.committed, []);
    assert.ok(result.sql.includes('ROLLBACK'));
    assert.equal(result.networkCalls, 0);
  });
}

test('rejected VIN creation never queues or sends a message', async () => {
  const result = await scenario({ fail: 'create' });
  assert.match(result.error.message, /create failed/);
  assert.deepEqual(result.committed, []);
  assert.equal(result.networkCalls, 0);
});
