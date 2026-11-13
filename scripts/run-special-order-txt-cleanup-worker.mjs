// Dedicated, opt-in TXT cleanup worker. Never start from HTTP or Telegram.
// Run as one independent PM2 process after migration 130 is installed and tested.
import "dotenv/config";
import { pool } from "../src/config/db.js";
import {
  TXT_CLEANUP_ROOT,
  processNextTxtCleanup,
} from "../src/services/SpecialOrderTxtCleanupQueueService.js";

if (
  process.env.MAKA_TXT_CLEANUP_WORKER_ENABLED !== "true" ||
  process.env.MAKA_TXT_UPLOAD_MODE !== "PRODUCTION_UPLOAD_ONLY" ||
  process.env.MAKA_TXT_UPLOAD_ROOT !== TXT_CLEANUP_ROOT
) {
  console.error("TXT_CLEANUP_WORKER_DISABLED_OR_UNTRUSTED_CONFIG");
  process.exit(1);
}

let running = false;
let stopping = false;

async function tick() {
  if (running || stopping) return;
  running = true;
  try {
    for (let n = 0; n < 5 && !stopping; n += 1) {
      const db = await pool.connect();
      let result;
      try {
        result = await processNextTxtCleanup({ db });
      } finally {
        db.release();
      }

      if (result.status === "BUSY" || result.status === "IDLE") break;
      // Intentionally log no paths, file identifiers, credentials, or PII.
      console.info("TXT_CLEANUP_JOB", result.status);
    }
  } catch {
    console.error("TXT_CLEANUP_WORKER_CYCLE_FAILED");
  } finally {
    running = false;
  }
}

async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  // Allow an in-progress transactional job to finish before PM2 stops.
  while (running) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await pool.end();
}

const interval = setInterval(() => { void tick(); }, 30_000);
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });

console.info("TXT_CLEANUP_WORKER_READY");
await tick();
