import { runDataRetention } from '../src/services/DataRetentionService.js';
import { pool } from '../src/config/db.js';

try {
  console.log(JSON.stringify(await runDataRetention({ dryRun: true }), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
