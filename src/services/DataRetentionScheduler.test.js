import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataRetentionScheduler } from './DataRetentionScheduler.js';
import { runDataRetention } from './DataRetentionService.js';

test('retention starts once, stops timers, and supports emergency disable', () => {
  const created = [], cleared = [];
  const timers = {
    setTimeout(fn, delay) { const timer = { fn, delay }; created.push(timer); return timer; },
    setInterval(fn, delay) { const timer = { fn, delay }; created.push(timer); return timer; },
    clearTimeout(timer) { cleared.push(timer); }, clearInterval(timer) { cleared.push(timer); },
  };
  const scheduler = createDataRetentionScheduler({ timers });
  scheduler.start({ enabled: false });
  assert.equal(created.length, 0);
  scheduler.start({ enabled: true });
  scheduler.start({ enabled: true });
  assert.deepEqual(created.map(timer => timer.delay), [60_000, 3_600_000]);
  scheduler.stop();
  assert.equal(cleared.length, 2);
});

test('retention does not overlap ticks, retries failures and stays quiet when not due', async () => {
  let finish, calls = 0;
  const errors = [], logs = [];
  const scheduler = createDataRetentionScheduler({
    run: async (options) => {
      assert.equal(options.dryRun, false);
      calls++;
      if (calls === 1) return new Promise(resolve => { finish = resolve; });
      if (calls === 2) throw new Error('temporary connection error');
      return { status: 'NOT_DUE' };
    },
    logger: { log: (...args) => logs.push(args), error: (...args) => errors.push(args) },
  });
  const active = scheduler.tick();
  await scheduler.tick();
  assert.equal(calls, 1);
  finish({ status: 'COMPLETED' });
  await active;
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(calls, 3);
  assert.equal(errors.length, 1);
  assert.equal(logs.length, 1);
});

test('retention fails closed without its migration and rejects unsafe batch settings', async () => {
  let released = false;
  const queries = [];
  const dbPool = { connect: async () => ({
    query: async sql => { queries.push(sql); return { rows: [{ ready: false }] }; },
    release() { released = true; },
  }) };
  assert.equal((await runDataRetention({ dbPool, dryRun: false })).status, 'MIGRATION_REQUIRED');
  assert.equal(queries.length, 1);
  assert.equal(released, true);
  await assert.rejects(runDataRetention({ dbPool, batchSize: 100000 }), /batchSize/);
});

test('a partial initial cleanup schedules continuation and stop cancels it', async () => {
  const delays = [], cleared = [];
  const timers = {
    setTimeout(fn, delay) { const timer = { fn, delay }; delays.push(timer); return timer; },
    setInterval() { return {}; }, clearTimeout(timer) { cleared.push(timer); }, clearInterval() {},
  };
  const scheduler = createDataRetentionScheduler({ timers, run: async () => ({ status: 'PARTIAL' }), logger: { log() {}, error() {} } });
  scheduler.start({ enabled: true });
  await scheduler.tick();
  assert.deepEqual(delays.map(timer => timer.delay), [60_000, 60_000]);
  scheduler.stop();
  assert.equal(cleared.length, 2);
});
