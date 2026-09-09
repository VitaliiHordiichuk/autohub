import { runDataRetention } from './DataRetentionService.js';

export function createDataRetentionScheduler({
  run = runDataRetention, logger = console, timers = globalThis,
} = {}) {
  let startup = null;
  let interval = null;
  let retry = null;
  let started = false;
  let running = false;
  let missingMigrationReported = false;
  function retryLater(delay) {
    if (!started || retry) return;
    retry = timers.setTimeout(() => { retry = null; void tick(); }, delay);
    retry.unref?.();
  }
  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await run({ dryRun: false });
      if (result.status === 'MIGRATION_REQUIRED') {
        if (!missingMigrationReported) logger.error('Data retention requires migration 077; no data was deleted.');
        missingMigrationReported = true;
      } else if (!['NOT_DUE', 'ALREADY_RUNNING'].includes(result.status)) {
        missingMigrationReported = false;
        logger.log('Data retention:', JSON.stringify(result));
        if (result.status === 'PARTIAL') retryLater(60_000);
      }
    } catch (error) {
      logger.error('Data retention failed; will retry automatically:', error.message);
      retryLater(300_000);
    } finally {
      running = false;
    }
  }
  return {
    start({ enabled = !['false','0','no','off'].includes(String(process.env.DATA_RETENTION_ENABLED ?? 'true').toLowerCase().trim()) } = {}) {
      if (!enabled || startup || interval) return;
      started = true;
      startup = timers.setTimeout(() => { startup = null; void tick(); }, 60_000);
      startup.unref?.();
      // Poll hourly for restart/failure recovery; persisted checkpoint permits a full run once a day.
      interval = timers.setInterval(() => void tick(), 3_600_000);
      interval.unref?.();
    },
    stop() {
      if (startup) timers.clearTimeout(startup);
      if (interval) timers.clearInterval(interval);
      if (retry) timers.clearTimeout(retry);
      startup = interval = retry = null;
      started = false;
    },
    tick,
  };
}

const scheduler = createDataRetentionScheduler();
export const startDataRetentionScheduler = () => scheduler.start();
export const stopDataRetentionScheduler = () => scheduler.stop();
