import { pool } from "../src/config/db.js";
import {
  CustomerTaxonomyBackfillError,
  CustomerTaxonomyBackfillService,
  parseCustomerTaxonomyBackfillArguments,
} from "../src/services/CustomerTaxonomyBackfillService.js";

function printHelp() {
  console.log(`MAKA controlled customer taxonomy backfill

Usage:
  npm run customer-taxonomy:backfill
  npm run customer-taxonomy:backfill -- --verify
  npm run customer-taxonomy:backfill -- --apply \\
    --confirm=AUTO_APPROVED_ONLY --expected-count=901

The default mode is DRY_RUN. APPLY uses one SERIALIZABLE transaction and
aborts without writes when any hard precondition fails.`);
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    printHelp();
    return;
  }
  const options = parseCustomerTaxonomyBackfillArguments(argumentsList);
  const report = await CustomerTaxonomyBackfillService.run({
    ...options,
    dbPool: pool,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    if (error instanceof CustomerTaxonomyBackfillError && error.report) {
      console.error(JSON.stringify(error.report, null, 2));
    } else {
      console.error(`Customer taxonomy backfill failed: ${error.message}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
