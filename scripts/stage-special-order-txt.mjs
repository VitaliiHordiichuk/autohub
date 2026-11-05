#!/usr/bin/env node
/**
 * STAGING DATABASE ONLY. Refuses production-like DB names/remote hosts.
 * Imports accepted Mercedes TXT rows as an unactivated READY revision.
 * Never writes public products, offers, sitemaps or source active pointer.
 */
import { stageSpecialOrderTxt } from "../src/services/SpecialOrderStageImportService.js";

function get(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1] ?? null;
}
const expectedLines = Number(get("--expected-lines"));
const expectedAccepted = Number(get("--expected-accepted"));
const expectedPricingConflicts = Number(get("--expected-conflicts"));
const filename = get("--file");
const expectedSha256 = get("--sha256");
const explicitConfirmation = get("--confirm-stage-only");
const database = process.env.DB_NAME || "";
const host = process.env.DB_HOST || "";

if (explicitConfirmation !== "I_CONFIRM_ISOLATED_TEST_DB" ||
    !/_(preview|test)$/i.test(database) ||
    !["127.0.0.1", "localhost", "::1"].includes(host) ||
    !process.env.DB_USER || !process.env.DB_PORT ||
    !filename || !/^[0-9a-f]{64}$/.test(expectedSha256 || "") ||
    !get("--expected-lines") || !get("--expected-accepted") ||
    !get("--expected-conflicts")) {
  console.error(
    "REFUSED: Supply --confirm-stage-only I_CONFIRM_ISOLATED_TEST_DB, " +
    "local DB_HOST, DB_NAME ending _preview/_test and explicit source counts/SHA-256."
  );
  process.exit(2);
}
const { pool } = await import("../src/config/db.js");
const client = await pool.connect();
try {
  const check = await client.query(
    `SELECT current_database() AS db_name,
         to_regclass('public.special_order_entries') AS entries,
         to_regclass('public.special_order_import_runs') AS runs`
  );
  const row = check.rows[0];
  if (row?.db_name !== database || !row.entries || !row.runs) {
    throw new Error("Isolated database or migration 125 not verified; no import started");
  }
  console.error("ISOLATED STAGE DB:", row.db_name);
  console.error("No active source pointer will be changed.");
  const summary = await stageSpecialOrderTxt({
    client, filename,
    encoding: get("--encoding") || "windows-1251",
    expectedSha256, expectedLines, expectedAccepted,
    expectedPricingConflicts,
    onProgress: ({ lines, accepted }) => console.error("STAGED:", lines, accepted),
  });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  client.release();
  await pool.end();
}
