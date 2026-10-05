import { pool } from "../src/config/db.js";
import { CustomerTaxonomyPhase2G1PreviewService } from "../src/services/CustomerTaxonomyPhase2G1PreviewService.js";

function printHelp() {
  console.log(`MAKA customer taxonomy PHASE 2G.1 read-only preview

Usage:
  npm run customer-taxonomy:preview:phase2g1

The command evaluates the accepted 962-product Body/Glass and Interior/Safety
review in a READ ONLY transaction. It has no --apply mode and never writes memberships.`);
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    printHelp();
    return;
  }
  if (argumentsList.length) throw new Error(`Unknown argument: ${argumentsList[0]}`);
  const report = await CustomerTaxonomyPhase2G1PreviewService.run({ dbPool: pool });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(`Customer taxonomy PHASE 2G.1 preview failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
