import { pool } from "../src/config/db.js";
import { CustomerTaxonomyPreviewService } from "../src/services/CustomerTaxonomyPreviewService.js";

function printHelp() {
  console.log(`MAKA customer taxonomy read-only preview

Usage:
  npm run customer-taxonomy:preview

The command always uses a READ ONLY transaction and never writes memberships.
There is intentionally no --apply mode.`);
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
  const report = await CustomerTaxonomyPreviewService.run({ dbPool: pool });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(`Customer taxonomy preview failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
