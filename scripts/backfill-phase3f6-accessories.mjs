import { pool } from "../src/config/db.js";
import {
  CustomerTaxonomyPhase3FAccessoriesBackfillError,
  CustomerTaxonomyPhase3FAccessoriesBackfillService,
  parsePhase3FAccessoriesBackfillArguments,
} from "../src/services/CustomerTaxonomyPhase3FAccessoriesBackfillService.js";

function printHelp() {
  console.log(`MAKA PHASE 3F.6 controlled accessories allowlist backfill

Usage:
  npm run customer-taxonomy:backfill:phase3f6-accessories
  npm run customer-taxonomy:backfill:phase3f6-accessories -- --apply \\
    --confirm=PHASE3F6_ACCESSORIES_ALLOWLIST

The default mode is DRY_RUN. APPLY uses one SERIALIZABLE transaction and
commits only the exact reviewed 32-product allowlist to the accessories root.
A complete existing target set is returned as a read-only idempotent no-op.`);
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    printHelp();
    return;
  }
  const options = parsePhase3FAccessoriesBackfillArguments(argumentsList);
  const report = await CustomerTaxonomyPhase3FAccessoriesBackfillService.run({
    ...options,
    dbPool: pool,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    if (
      error instanceof CustomerTaxonomyPhase3FAccessoriesBackfillError
      && error.report
    ) {
      console.error(JSON.stringify(error.report, null, 2));
    } else {
      console.error(`PHASE 3F.6 accessories backfill failed: ${error.message}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
