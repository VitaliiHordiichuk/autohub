import { pool } from '../src/config/db.js';
import { collectProductImageGarbage } from '../src/services/ProductImageGarbageCollector.js';

// Dry-run is always the default. This command never scans the bucket or deletes unknown objects.
try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && !/^--limit=\d+$/.test(arg))) throw new Error('Usage: node scripts/collect-product-image-garbage.mjs [--apply] [--limit=20]');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  console.log(JSON.stringify(await collectProductImageGarbage({ apply: args.includes('--apply'), limit: limitArg ? Number(limitArg.split('=')[1]) : 20 }), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
