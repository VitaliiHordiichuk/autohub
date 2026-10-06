import { pool } from "../src/config/db.js";
import {
  CustomerTaxonomyPhase3CSteeringUpgradeError,
  CustomerTaxonomyPhase3CSteeringUpgradeService,
  parsePhase3CSteeringUpgradeArguments,
} from "../src/services/CustomerTaxonomyPhase3CSteeringUpgradeService.js";

function printHelp() {
  console.log(`MAKA PHASE 3C controlled steering-pump membership upgrade

Usage:
  npm run customer-taxonomy:upgrade:phase3c-steering-pumps
  npm run customer-taxonomy:upgrade:phase3c-steering-pumps -- --verify
  npm run customer-taxonomy:upgrade:phase3c-steering-pumps -- --apply \\
    --confirm=PHASE3C_STEERING_PUMPS \\
    --expected-count=2

The default mode is DRY_RUN. APPLY uses one SERIALIZABLE transaction, locks
both product and membership rows, and aborts all changes on any mismatch.`);
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    printHelp();
    return;
  }
  const options = parsePhase3CSteeringUpgradeArguments(argumentsList);
  const report = await CustomerTaxonomyPhase3CSteeringUpgradeService.run({
    ...options,
    dbPool: pool,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    if (error instanceof CustomerTaxonomyPhase3CSteeringUpgradeError && error.report) {
      console.error(JSON.stringify(error.report, null, 2));
    } else {
      console.error(`PHASE 3C steering upgrade failed: ${error.message}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
