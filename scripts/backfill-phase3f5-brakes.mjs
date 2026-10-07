import { pool } from "../src/config/db.js";
import {
  CustomerTaxonomyPhase3FBrakesBackfillError,
  CustomerTaxonomyPhase3FBrakesBackfillService,
  parsePhase3FBrakesBackfillArguments,
} from "../src/services/CustomerTaxonomyPhase3FBrakesBackfillService.js";

function printHelp() {
  console.log(`MAKA PHASE 3F.5 controlled EPC 42/43 brakes backfill

Usage:
  npm run customer-taxonomy:backfill:phase3f5-brakes
  npm run customer-taxonomy:backfill:phase3f5-brakes -- --apply \\
    --confirm=PHASE3F4_BRAKES_BACKFILL

The default mode is DRY_RUN. APPLY uses one SERIALIZABLE transaction and
commits only the reviewed 1 HIGH + 96 SAFE target set. A fully applied target
set produces a read-only idempotent no-op; a partial target state is rejected.`);
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    printHelp();
    return;
  }
  const options = parsePhase3FBrakesBackfillArguments(argumentsList);
  const report = await CustomerTaxonomyPhase3FBrakesBackfillService.run({
    ...options,
    dbPool: pool,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    if (error instanceof CustomerTaxonomyPhase3FBrakesBackfillError && error.report) {
      console.error(JSON.stringify(error.report, null, 2));
    } else {
      console.error(`PHASE 3F.5 brakes backfill failed: ${error.message}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
