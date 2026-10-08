import { pool } from "../src/config/db.js";
import {
  CustomerTaxonomyWindshieldBackfillError,
  parseWindshieldBackfillArguments,
  runWindshieldBackfill,
} from "../src/services/CustomerTaxonomyWindshieldBackfillService.js";

function help() {
  console.log(`MAKA controlled windshield customer-taxonomy backfill

Dry run:
  npm run customer-taxonomy:backfill:windshields

Apply after reviewing the dry-run count:
  npm run customer-taxonomy:backfill:windshields -- --apply \\
    --confirm=CUSTOMER_TAXONOMY_WINDSHIELDS --expected-count=<COUNT>

DRY_RUN uses a read-only transaction. APPLY uses one SERIALIZABLE transaction
and rolls back on any count, candidate, rule or integrity mismatch.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) return help();
  const report = await runWindshieldBackfill(parseWindshieldBackfillArguments(args));
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  if (error instanceof CustomerTaxonomyWindshieldBackfillError && error.report) {
    console.error(JSON.stringify(error.report, null, 2));
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
