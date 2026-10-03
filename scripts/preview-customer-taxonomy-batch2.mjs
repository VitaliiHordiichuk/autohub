import { pool } from "../src/config/db.js";
import { CustomerTaxonomyBatchPreviewService } from "../src/services/CustomerTaxonomyBatchPreviewService.js";

function printHelp() {
  console.log(`MAKA customer taxonomy PHASE 2D read-only preview

Usage:
  npm run customer-taxonomy:preview:batch2

The command reuses the production resolver through a READ ONLY transaction.
It never writes customer memberships and has no --apply mode.`);
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    printHelp();
    return;
  }
  if (argumentsList.length) {
    throw new Error(`Unknown argument: ${argumentsList[0]}`);
  }
  const report = await CustomerTaxonomyBatchPreviewService.run({ dbPool: pool });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(`Customer taxonomy PHASE 2D preview failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
