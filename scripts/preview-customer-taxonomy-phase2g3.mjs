import { pool } from "../src/config/db.js";
import { CustomerTaxonomyPhase2G3PreviewService } from "../src/services/CustomerTaxonomyPhase2G3PreviewService.js";

function printHelp() {
  console.log(`MAKA customer taxonomy PHASE 2G.3 read-only preview

Usage:
  npm run customer-taxonomy:preview:phase2g3

The command evaluates the accepted 1964-product Fasteners / Seals / Standard Parts
review in a READ ONLY transaction. It has no --apply mode and never writes memberships.`);
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    printHelp();
    return;
  }
  if (argumentsList.length) throw new Error(`Unknown argument: ${argumentsList[0]}`);
  const report = await CustomerTaxonomyPhase2G3PreviewService.run({ dbPool: pool });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(`Customer taxonomy PHASE 2G.3 preview failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
