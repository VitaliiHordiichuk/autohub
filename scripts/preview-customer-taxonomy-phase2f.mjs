import { pool } from "../src/config/db.js";
import { CustomerTaxonomyPhase2FPreviewService } from "../src/services/CustomerTaxonomyPhase2FPreviewService.js";

function printHelp() {
  console.log(`MAKA customer taxonomy PHASE 2F read-only preview

Usage:
  npm run customer-taxonomy:preview:phase2f

The command evaluates the accepted 1,360-product engine/suspension review in a
READ ONLY transaction. It has no --apply mode and never writes memberships.`);
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    printHelp();
    return;
  }
  if (argumentsList.length) throw new Error(`Unknown argument: ${argumentsList[0]}`);
  const report = await CustomerTaxonomyPhase2FPreviewService.run({ dbPool: pool });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(`Customer taxonomy PHASE 2F preview failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
