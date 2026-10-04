import { pool } from "../src/config/db.js";
import { CustomerTaxonomyPhase2EPreviewService } from "../src/services/CustomerTaxonomyPhase2EPreviewService.js";

function printHelp() {
  console.log(`MAKA customer taxonomy PHASE 2E read-only preview

Usage:
  npm run customer-taxonomy:preview:phase2e

The command evaluates the accepted 620-product review through a READ ONLY
transaction. It has no --apply mode and never writes customer memberships.`);
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    printHelp();
    return;
  }
  if (argumentsList.length) throw new Error(`Unknown argument: ${argumentsList[0]}`);
  const report = await CustomerTaxonomyPhase2EPreviewService.run({ dbPool: pool });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(`Customer taxonomy PHASE 2E preview failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
