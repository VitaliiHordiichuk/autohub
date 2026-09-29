import { pool } from "../src/config/db.js";
import {
  reconcileReturnPolicyToLegacy,
} from "../src/services/ReturnPolicyLegacyReconciliationService.js";

export function parseArguments(argumentsList) {
  const options = { apply: false, help: false };
  for (const argument of argumentsList) {
    if (argument === "--apply") options.apply = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Synchronize new return-policy overrides to legacy boolean fields before rollback.

Usage:
  npm run sync:return-policy-legacy
  npm run sync:return-policy-legacy -- --apply

Default mode is DRY RUN. It opens a read-only transaction, prints the projected
legacy values and rolls back. --apply updates only warehouses.returnable_by_default
and product_offers.is_returnable in one transaction.`);
}

function printCounts(label, counts) {
  console.log(`${label}:`);
  console.log(`  warehouses TRUE=${counts.warehouses.true} FALSE=${counts.warehouses.false}`);
  console.log(`  offers NULL=${counts.offers.null} TRUE=${counts.offers.true} FALSE=${counts.offers.false}`);
}

function printSummary(summary) {
  console.log(`Mode: ${summary.mode}`);
  printCounts("Before", summary.before);
  console.log("Would change:");
  console.log(`  warehouses to TRUE=${summary.changes.warehouses.toTrue} to FALSE=${summary.changes.warehouses.toFalse}`);
  console.log(`  offers to NULL=${summary.changes.offers.toNull} to TRUE=${summary.changes.offers.toTrue} to FALSE=${summary.changes.offers.toFalse}`);
  printCounts(summary.committed ? "After" : "After (projected)", summary.after);
  console.log(summary.committed
    ? `Committed: warehouses=${summary.updated.warehouses} offers=${summary.updated.offers}`
    : "Dry run complete: no rows changed.");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  printSummary(await reconcileReturnPolicyToLegacy({
    apply: options.apply,
    dbPool: pool,
  }));
}

main()
  .catch((error) => {
    console.error(`Return-policy legacy reconciliation failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
