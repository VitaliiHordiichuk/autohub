#!/usr/bin/env node
/**
 * Read real staged TXT prices from the isolated PostgreSQL 16 TEST cluster.
 * Temporarily expose the READY import only to this DB session's transaction,
 * run lookup/parity checks and EXPLAIN, then ALWAYS ROLLBACK the source pointer.
 * No catalog/production writes; no website or bot changes.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { pool } from "../src/config/db.js";
import { lookupSpecialOrderArticle } from "../src/services/SpecialOrderLookupService.js";

const TEST = {
  host: "127.0.0.1",
  port: "5545",
  database: "maka_special_order_preview",
  user: "ubuntu",
  dataDirectory: "/home/ubuntu/maka-special-order/isolated-pg16-20261105/data",
  importId: 1,
};
const CONFLICTS = [
  "A22268027293E19",
  "C93401212122902",
  "QALES3004CASCOCLI",
  "QALES90418902",
  "QALES90418903",
  "QSICHERBOXXLBAT13",
];

for (const [field, env] of [
  ["host", "DB_HOST"], ["port", "DB_PORT"],
  ["database", "DB_NAME"], ["user", "DB_USER"],
]) {
  assert.equal(process.env[env], TEST[field], "Refusing unexpected " + env);
}
assert.ok(process.env.DB_PASSWORD, "Refusing missing test password");
assert.equal(process.env.SPECIAL_ORDER_EXPECTED_PGDATA, TEST.dataDirectory);

const client = await pool.connect();
let transactionOpen = false;
let success = false;
try {
  const fingerprint = (await client.query(
    `SELECT current_database() AS database,
            current_setting('port') AS port,
            current_setting('data_directory') AS data_directory`
  )).rows[0];
  assert.deepEqual(fingerprint, {
    database: TEST.database, port: TEST.port,
    data_directory: TEST.dataDirectory,
  });
  const state = (await client.query(
    `SELECT
       (SELECT COUNT(*)::integer FROM special_order_import_runs) AS runs,
       (SELECT COUNT(*)::integer FROM special_order_sources) AS sources,
       (SELECT status FROM special_order_import_runs WHERE id = $1) AS status,
       (SELECT eligible_lines FROM special_order_import_runs WHERE id = $1) AS accepted`,
    [TEST.importId]
  )).rows[0];
  assert.equal(state.runs, 1);
  assert.equal(state.sources, 0);
  assert.equal(state.status, "READY");
  assert.equal(Number(state.accepted), 1543399);

  // The pointer is visible only inside this transaction, not to other sessions.
  await client.query("BEGIN");
  transactionOpen = true;
  await client.query(
    `INSERT INTO special_order_sources (source_key, active_import_id)
     VALUES ('mercedes-txt', $1)`,
    [TEST.importId]
  );

  async function check(article, tier, expectedPrice, expectedLength = 1) {
    const start = performance.now();
    const rows = await lookupSpecialOrderArticle({
      article, priceGroupName: tier, db: client,
    });
    const ms = Math.round((performance.now() - start) * 100) / 100;
    assert.equal(rows.length, expectedLength, "Wrong number of results for " + article);
    if (expectedLength) {
      assert.equal(rows[0].priceUah, expectedPrice, "Wrong price for " + article);
      assert.equal(rows[0].requiresManagerConfirmation, true);
      assert.equal(rows[0].status, "SPECIAL_ORDER_INQUIRY");
      assert.equal(rows[0].currency, "UAH");
    }
    return { article, tier, returned: rows.length,
      priceUah: rows[0]?.priceUah ?? null, ms };
  }

  const results = [];
  for (const [tier, price] of [
    ["Guest", 13188.75], ["Registered", 13188.75],
    ["GOLD", 10522.94], ["VIP", 10522.94],
  ]) {
    results.push(await check("A4058819501", tier, price));
  }
  const duplicate = await lookupSpecialOrderArticle({
    article: "QALES9150103", priceGroupName: "Guest", db: client,
  });
  assert.equal(duplicate.length, 1, "Exact repeated article must collapse to one result");
  results.push({ article: "QALES9150103", returned: duplicate.length,
    priceUah: duplicate[0].priceUah });

  for (const article of CONFLICTS) {
    results.push(await check(article, "Guest", null, 0));
  }
  for (const article of ["A4058819501W", "A99999999999"]) {
    results.push(await check(article, "Guest", null, 0));
  }

  // EXPLAIN actual lookup SQL with real bind parameters; don't guess speed.
  // The service's own query is captured and explained, not a different hand-
  // written SQL approximation.
  let searchSql = null;
  let searchParams = null;
  const observer = {
    async query(sql, params) {
      searchSql = sql; searchParams = params;
      return client.query(sql, params);
    },
  };
  await lookupSpecialOrderArticle({
    article: "A4058819501", priceGroupName: "Guest", db: observer,
  });
  const explain = (await client.query(
    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + searchSql,
    searchParams
  )).rows[0]["QUERY PLAN"][0];

  console.log(JSON.stringify({
    mode: "ISOLATED_POSTGRESQL_ROLLBACK_ONLY",
    database: TEST.database, importId: TEST.importId,
    tests: results, plan: explain.Plan,
    executionTimeMs: explain["Execution Time"],
  }, null, 2));

  success = true;
} finally {
  try {
    if (transactionOpen) {
      await client.query("ROLLBACK");
      transactionOpen = false;
    }
    const active = (await client.query(
      "SELECT COUNT(*)::integer AS n FROM special_order_sources WHERE active_import_id IS NOT NULL"
    )).rows[0].n;
    assert.equal(active, 0, "Test source pointer must not persist after ROLLBACK");
    if (success) console.error("PASS: active_sources=0 after ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
}
