import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isVinTelegramDeliveryEnabled, processOneVinTelegramDelivery,
  runVinTelegramDeliveryBatch, startVinTelegramDeliveryScheduler,
} from './VinTelegramDeliveryScheduler.js';

const enabledEnv = { NODE_ENV: 'production', MAKA_VIN_TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'test-placeholder', BACKGROUND_JOBS_ENABLED: 'true' };
const delivery = { id: '9007199254740993', claimToken: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', status: 'IN_FLIGHT', attempts: 1 };
const data = {
  stillAuthorized: true, chatId: '12345', event: 'NEW_REQUEST', message: '', locale: 'uk',
  request: { id: '42', vin: 'WDD2120471A387679', request_text: 'Передні <колодки>', guest_name: 'Іван & Олена', contact_phone: '+380671234567' },
};
function fixture(overrides = {}) {
  const sent = [], finished = [], logs = [];
  const options = {
    claim: async () => delivery, load: async () => data,
    finish: async (row, outcome) => { finished.push({ row, outcome }); },
    transport: async (chat, payload) => { sent.push({ chat, payload }); },
    frontendUrl: 'https://maka.com.ua', logger: { error(message) { logs.push(message); } },
    ...overrides,
  };
  return { options, sent, finished, logs };
}

test('worker requires explicit VIN opt-in, token, background permission and non-test runtime', () => {
  assert.equal(isVinTelegramDeliveryEnabled(enabledEnv), true);
  for (const env of [{}, { ...enabledEnv, MAKA_VIN_TELEGRAM_ENABLED: '1' }, { ...enabledEnv, MAKA_VIN_TELEGRAM_ENABLED: 'TRUE' }, { ...enabledEnv, TELEGRAM_BOT_TOKEN: '   ' }, { ...enabledEnv, NODE_ENV: 'test' }, { ...enabledEnv, BACKGROUND_JOBS_ENABLED: 'false' }, { ...enabledEnv, BACKGROUND_JOBS_ENABLED: 'off' }]) {
    assert.equal(isVinTelegramDeliveryEnabled(env), false);
  }
});

test('guest VIN reaches the authorized staff chat with escaped HTML and request link', async () => {
  const f = fixture();
  assert.equal(await processOneVinTelegramDelivery(f.options), 'SENT');
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].chat, '12345');
  assert.equal(f.sent[0].payload.parse_mode, 'HTML');
  assert.match(f.sent[0].payload.text, /Новий VIN-запит №42/);
  assert.match(f.sent[0].payload.text, /Іван &amp; Олена/);
  assert.match(f.sent[0].payload.text, /Передні &lt;колодки&gt;/);
  assert.match(f.sent[0].payload.text, /<code>\+380671234567<\/code>/);
  assert.equal(f.sent[0].payload.reply_markup.inline_keyboard[0][0].url, 'https://maka.com.ua/uk/admin/vin-requests?request=42');
  assert.deepEqual(f.finished, [{ row: { ...delivery, chatId: '12345' }, outcome: 'SENT' }]);
});

test('client follow-up delivers that message, not a repeated initial request', async () => {
  const f = fixture({ load: async () => ({ ...data, event: 'CLIENT_MESSAGE', message: 'Ще <фільтр>', request: { ...data.request, first_name: 'Клієнт', guest_name: null } }) });
  assert.equal(await processOneVinTelegramDelivery(f.options), 'SENT');
  assert.match(f.sent[0].payload.text, /Нове повідомлення у VIN-запиті №42/);
  assert.match(f.sent[0].payload.text, /Ще &lt;фільтр&gt;/);
  assert.doesNotMatch(f.sent[0].payload.text, /Передні/);
});

test('unauthorized staff and already delivered shared chats are skipped without transport', async () => {
  const f = fixture({ load: async () => ({ stillAuthorized: false }) });
  assert.equal(await processOneVinTelegramDelivery(f.options), 'SKIPPED');
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.finished, [{ row: delivery, outcome: 'SKIPPED' }]);
});

test('empty, expired/exhausted and lost claims perform no send', async () => {
  for (const [overrides, expected] of [[{ claim: async () => null }, 'EMPTY'], [{ claim: async () => ({ ...delivery, status: 'FAILED' }) }, 'FAILED'], [{ load: async () => null }, 'CLAIM_LOST']]) {
    const f = fixture(overrides);
    assert.equal(await processOneVinTelegramDelivery(f.options), expected);
    assert.equal(f.sent.length, 0);
    assert.equal(f.finished.length, 0);
  }
});

test('transport failure records retry without revealing request, phone, chat or token in logs', async () => {
  const f = fixture({ transport: async () => { throw new Error('sensitive token +380671234567 chat12345 VINWDD2120471A387679'); } });
  assert.equal(await processOneVinTelegramDelivery(f.options), 'RETRY');
  assert.deepEqual(f.finished, [{ row: { ...delivery, chatId: '12345' }, outcome: 'RETRY' }]);
  assert.deepEqual(f.logs, ['VIN Telegram delivery attempt failed']);
});

test('failed retry persistence leaves lease recovery to repository and logs only static errors', async () => {
  const f = fixture({ transport: async () => { throw Error('private'); }, finish: async () => { throw Error('private database detail'); } });
  assert.equal(await processOneVinTelegramDelivery(f.options), 'RETRY');
  assert.deepEqual(f.logs, ['VIN Telegram delivery retry state unavailable', 'VIN Telegram delivery attempt failed']);
});

test('batch is bounded at10 and stops immediately once queue is empty', async () => {
  let count = 0;
  await runVinTelegramDeliveryBatch({ process: async () => { count++; return 'SENT'; } });
  assert.equal(count, 10);
  count = 0;
  await runVinTelegramDeliveryBatch({ process: async () => { count++; return count === 3 ? 'EMPTY' : 'RETRY'; } });
  assert.equal(count, 3);
});

test('scheduler is opt-in, single-start, and prevents overlapping15second ticks', async () => {
  let calls = 0, tick, unref = 0, release;
  const first = new Promise(resolve => { release = resolve; });
  const options = {
    run: async () => { calls++; if (calls === 1) await first; },
    schedule: (callback, ms) => { assert.equal(ms, 15_000); tick = callback; return { unref() { unref++; } }; },
    logger: { error() { throw Error('unexpected'); } },
  };
  assert.equal(startVinTelegramDeliveryScheduler({}, options), false);
  assert.equal(calls, 0);
  assert.equal(startVinTelegramDeliveryScheduler(enabledEnv, options), true);
  assert.equal(calls, 1);
  tick(); tick();
  assert.equal(calls, 1);
  release();
  await new Promise(resolve => setImmediate(resolve));
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(unref, 1);
  assert.equal(startVinTelegramDeliveryScheduler(enabledEnv, options), false);
});
