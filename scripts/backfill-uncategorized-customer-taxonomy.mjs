import "dotenv/config";
import { readFile } from "node:fs/promises";

function argument(name, fallback = null) {
  const match = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : fallback;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(`Usage (default: read-only dry-run):
  node scripts/backfill-uncategorized-customer-taxonomy.mjs --after-id=6653 --limit=102
  node scripts/backfill-uncategorized-customer-taxonomy.mjs --apply --plan=plan.json --confirm=APPLY_REVIEWED_UNCATEGORIZED_PLAN
  node scripts/backfill-uncategorized-customer-taxonomy.mjs --restore --plan=plan.json --confirm=RESTORE_UNCATEGORIZED_PLAN

The JSON dry-run output includes a plan array. Save only reviewed AUTO_HIGH entries
(maximum 25 per apply). Apply and restore require an explicit plan and confirmation.
Non-test databases additionally require --allow-non-test-db after separate approval.`);
    return;
  }
  const mode = process.argv.includes("--apply") ? "APPLY"
    : process.argv.includes("--restore") ? "RESTORE" : "DRY_RUN";
  if (process.argv.includes("--apply") && process.argv.includes("--restore")) {
    throw new Error("Apply and restore cannot be combined");
  }
  if (!String(process.env.DB_NAME || "").endsWith("_test")
    && !process.argv.includes("--allow-non-test-db")) {
    throw new Error("Refusing non-test database without --allow-non-test-db");
  }
  const planPath = argument("--plan");
  if (mode !== "DRY_RUN" && !planPath) throw new Error("Apply/restore requires --plan");
  const parsed = planPath ? JSON.parse(await readFile(planPath, "utf8")) : null;
  const plan = Array.isArray(parsed) ? parsed : parsed?.plan;
  const { runUncategorizedBackfill } = await import(
    "../src/services/CustomerTaxonomyUncategorizedBackfillService.js"
  );
  const { pool } = await import("../src/config/db.js");
  try {
    const report = await runUncategorizedBackfill({
      mode,
      afterId: Number(argument("--after-id", 0)),
      limit: Number(argument("--limit", 100)),
      plan,
      confirmation: argument("--confirm"),
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Uncategorized taxonomy backfill failed: ${error.message}`);
  process.exitCode = 1;
});
