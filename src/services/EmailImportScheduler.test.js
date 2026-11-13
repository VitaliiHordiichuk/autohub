import test from "node:test";
import assert from "node:assert/strict";
import { startEmailImportScheduler, stopEmailImportScheduler } from "./EmailImportScheduler.js";

test("legacy EMAIL cannot start from an old enabled flag while latest owns import", () => {
  const previousOwner = process.env.MAKA_EMAIL_IMPORT_OWNER;
  const previousFlag = process.env.EMAIL_IMPORT_SCHEDULER_ENABLED;
  const originalTimeout = globalThis.setTimeout;
  const originalInterval = globalThis.setInterval;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalClearInterval = globalThis.clearInterval;
  const scheduled = [], cleared = [];
  globalThis.setTimeout = (_, ms) => { const timer = { ms, unref() {} }; scheduled.push(timer); return timer; };
  globalThis.setInterval = globalThis.setTimeout;
  globalThis.clearTimeout = timer => cleared.push(timer);
  globalThis.clearInterval = globalThis.clearTimeout;
  try {
    process.env.EMAIL_IMPORT_SCHEDULER_ENABLED = "true";
    delete process.env.MAKA_EMAIL_IMPORT_OWNER;
    startEmailImportScheduler();
    process.env.MAKA_EMAIL_IMPORT_OWNER = "latest";
    startEmailImportScheduler();
    assert.equal(scheduled.length, 0);
    process.env.MAKA_EMAIL_IMPORT_OWNER = "legacy";
    process.env.EMAIL_IMPORT_SCHEDULER_ENABLED = "false";
    startEmailImportScheduler();
    assert.equal(scheduled.length, 0);
    process.env.EMAIL_IMPORT_SCHEDULER_ENABLED = "true";
    startEmailImportScheduler();
    startEmailImportScheduler();
    assert.deepEqual(scheduled.map(timer => timer.ms), [5000, 3600000]);
    stopEmailImportScheduler();
    assert.equal(cleared.length, 2);
  } finally {
    stopEmailImportScheduler();
    Object.assign(globalThis, { setTimeout: originalTimeout, setInterval: originalInterval,
      clearTimeout: originalClearTimeout, clearInterval: originalClearInterval });
    if (previousOwner === undefined) delete process.env.MAKA_EMAIL_IMPORT_OWNER;
    else process.env.MAKA_EMAIL_IMPORT_OWNER = previousOwner;
    if (previousFlag === undefined) delete process.env.EMAIL_IMPORT_SCHEDULER_ENABLED;
    else process.env.EMAIL_IMPORT_SCHEDULER_ENABLED = previousFlag;
  }
});
