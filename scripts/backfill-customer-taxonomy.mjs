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
  npm run customer-taxonomy:backfill -- --include-safe-top-level
  npm run customer-taxonomy:backfill -- --verify
  npm run customer-taxonomy:backfill -- --apply \\
    --confirm=AUTO_APPROVED_ONLY \\
    --expected-count=NNN
  npm run customer-taxonomy:backfill -- --include-safe-top-level --apply \\
    --confirm=SAFE_TOPLEVEL_EPC_FALLBACK \\
    --expected-count=NNN

The default mode is DRY_RUN. APPLY uses one SERIALIZABLE transaction and
aborts without writes when any hard precondition fails. SAFE_TOPLEVEL is an
explicit opt-in; without its flag the command remains HIGH RULE only. Replace
NNN with candidateCount from the immediately preceding current dry run.`);
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
