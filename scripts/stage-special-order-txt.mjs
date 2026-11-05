#!/usr/bin/env node
/**
 * STAGING DATABASE ONLY. Refuses production-like DB names/remote hosts.
 * Imports accepted Mercedes TXT rows as an unactivated READY revision.
 * Never writes public products, offers, sitemaps or source active pointer.
 */
import { realpathSync } from "node:fs";
import { stageSpecialOrderTxt } from "../src/services/SpecialOrderStageImportService.js";

function get(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1] ?? null;
}
const expectedLines = Number(get("--expected-lines"));
const expectedAccepted = Number(get("--expected-accepted"));
const expectedUniqueArticles = Number(get("--expected-unique"));
const expectedPricingConflicts = Number(get("--expected-conflicts"));
const filename = get("--file");
const expectedSha256 = get("--sha256");
const explicitConfirmation = get("--confirm-stage-only");
const database = process.env.DB_NAME || "";
const host = process.env.DB_HOST || "";
const expectedDataDirectory = process.env.SPECIAL_ORDER_EXPECTED_PGDATA || "";
const expectedPort = "5545";
const approvedDataRoot = "/home/ubuntu/maka-special-order/isolated-pg16-20261105/data";

if (explicitConfirmation !== "I_CONFIRM_ISOLATED_TEST_DB" ||
    !/_(preview|test)$/i.test(database) ||
    host !== "127.0.0.1" ||
    process.env.DB_PORT !== expectedPort ||
    expectedDataDirectory !== approvedDataRoot ||
    !process.env.DB_USER || !process.env.DB_PASSWORD ||
    !filename || !/^[0-9a-f]{64}$/.test(expectedSha256 || "") ||
    !get("--expected-lines") || !get("--expected-accepted") ||
    !get("--expected-unique") || !get("--expected-conflicts")) {
  console.error(
    "REFUSED: Supply --confirm-stage-only I_CONFIRM_ISOLATED_TEST_DB, " +
    "local DB_HOST, DB_NAME ending _preview/_test and explicit source counts/SHA-256."
  );
  process.exit(2);
}
// Realpath prevents a symlink disguising the production data directory.
if (realpathSync(expectedDataDirectory) !== approvedDataRoot) {
  throw new Error("REFUSED: the approved isolated PGDATA is not a real directory");
}
const { pool } = await import("../src/config/db.js");
const client = await pool.connect();
try {
  const check = await client.query(
    `SELECT current_database() AS db_name,
         current_setting('data_directory') AS data_directory,
         current_setting('port') AS pg_port,
         to_regclass('public.special_order_entries') AS entries,
         to_regclass('public.special_order_import_runs') AS runs,
         to_regclass('public.special_order_sources') AS sources`
  );
  const row = check.rows[0];
  if (row?.db_name !== database ||
      row.data_directory !== approvedDataRoot ||
      row.pg_port !== expectedPort ||
      !row.entries || !row.runs || !row.sources) {
    throw new Error("Isolated database or migration 125 not verified; no import started");
  }
  console.error("ISOLATED STAGE DB:", row.db_name);
  console.error("No active source pointer will be changed.");
  const summary = await stageSpecialOrderTxt({
    client, filename,
    encoding: get("--encoding") || "windows-1251",
    expectedSha256, expectedLines, expectedAccepted, expectedUniqueArticles,
    expectedPricingConflicts,
    onProgress: ({ lines, accepted }) => console.error("STAGED:", lines, accepted),
  });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  client.release();
  await pool.end();
}
