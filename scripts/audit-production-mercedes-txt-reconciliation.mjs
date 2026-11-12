#!/usr/bin/env node

/**
 * MAKA Mercedes TXT production reconciliation audit.
 *
 * READ ONLY:
 * - never creates or modifies jobs
 * - never updates database revisions
 * - never imports or activates
 * - never launches a worker
 *
 * Filesystem and database observations are not atomic.
 * Findings require manual verification before any repair.
 */

import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";
import pg from "pg";

import {
  assertProductionTxtStageEnvironment,
  assertProductionTxtDatabase,
} from "../src/services/SpecialOrderTxtProductionDatabaseGuard.js";

import {
  buildMercedesTxtReconciliationReport,
} from "../src/services/SpecialOrderTxtReconciliationReportService.js";

const args = process.argv.slice(2);

if (
  args.length !== 1 ||
  args[0] !== "--audit-only"
) {
  throw new Error("AUDIT_ONLY_ARGUMENT_REQUIRED");
}

const ROOT =
  "/home/ubuntu/maka-mercedes-txt-prod-uploads-20261110";

const ENV_FILE =
  "/home/ubuntu/maka-backend-identity-preview-20261105/.env";

assert.equal(process.env.NODE_ENV, "production");
assert.equal(
  process.env.MAKA_TXT_PRODUCTION_IMPORT_ENABLED,
  "false"
);
assert.equal(
  process.env.MAKA_TXT_ACTIVATION_ENABLED,
  "false"
);
assert.equal(
  process.env.BACKGROUND_JOBS_ENABLED,
  "false"
);

assert.equal(realpathSync(ROOT), ROOT);

const rootStat = statSync(ROOT);

assert.ok(rootStat.isDirectory());
assert.equal(rootStat.mode & 0o777, 0o700);

assert.equal(
  readFileSync(
    join(ROOT, ".production-marker"),
    "utf8"
  ).trim(),
  "MAKA_TXT_PRODUCTION_STORAGE_20261110"
);

const config = dotenv.parse(
  readFileSync(ENV_FILE)
);

assert.equal(config.DB_NAME, "autohub");
assert.equal(config.DB_USER, "autohub_app");
assert.equal(Number(config.DB_PORT), 5432);

assert.ok(
  typeof config.DB_PASSWORD === "string" &&
  config.DB_PASSWORD.length > 0
);

assert.ok(
  [
    "localhost",
    "127.0.0.1",
    "/var/run/postgresql",
  ].includes(config.DB_HOST),
  "UNEXPECTED_DB_HOST"
);

const host =
  config.DB_HOST === "localhost"
    ? "127.0.0.1"
    : config.DB_HOST;

const guardEnv = {
  NODE_ENV: "production",
  MAKA_TXT_STAGE_MODE: "PRODUCTION_READY_ONLY",
  MAKA_TXT_UPLOAD_MODE: "PRODUCTION_UPLOAD_ONLY",
  MAKA_TXT_UPLOAD_ROOT: ROOT,
  MAKA_TXT_PRODUCTION_IMPORT_ENABLED: "false",
  MAKA_TXT_ACTIVATION_ENABLED: "false",
  DB_HOST: host,
  DB_PORT: "5432",
  DB_NAME: "autohub",
  DB_USER: "autohub_app",
};

assert.equal(
  assertProductionTxtStageEnvironment(guardEnv),
  true
);

console.log("STRICT PRODUCTION GUARD: PASS");

const client = new pg.Client({
  host,
  port: 5432,
  database: "autohub",
  user: "autohub_app",
  password: config.DB_PASSWORD,
  connectionTimeoutMillis: 5000,
  options:
    "-c default_transaction_read_only=on " +
    "-c statement_timeout=12000 " +
    "-c lock_timeout=3000",
});

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-" +
  "[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const jobPattern = new RegExp(
  `^(${UUID})\\.txt\\.stage\\.json$`
);

const claimPattern = new RegExp(
  `^(${UUID})\\.txt\\.stage\\.claim\\.json$`
);

function readSecureJson(path) {
  const stat = lstatSync(path);

  assert.ok(
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.size <= 65536 &&
    (stat.mode & 0o077) === 0,
    "INSECURE_OR_INVALID_JOB_FILE"
  );

  return JSON.parse(readFileSync(path, "utf8"));
}

let transaction = false;

try {
  await client.connect();

  await client.query("BEGIN READ ONLY");
  transaction = true;

  const identity = await client.query(`
    SELECT
      current_database() AS db,
      current_user AS username,
      current_setting('port') AS port,
      current_setting('transaction_read_only')
        AS read_only,
      current_setting('default_transaction_read_only')
        AS default_read_only
  `);

  assert.deepEqual(identity.rows[0], {
    db: "autohub",
    username: "autohub_app",
    port: "5432",
    read_only: "on",
    default_read_only: "on",
  });

  await assertProductionTxtDatabase(
    client,
    guardEnv
  );

  console.log("PRODUCTION DATABASE IDENTITY: PASS");
  console.log("POSTGRESQL READ ONLY: PASS");

  const revisionsResult = await client.query(`
    SELECT
      id,
      status,
      upload_file_id::text AS file_id,
      source_sha256
    FROM special_order_import_runs
    WHERE source_key = 'mercedes-txt'
    ORDER BY id DESC
    LIMIT 1001
  `);

  assert.ok(
    revisionsResult.rows.length <= 1000,
    "TOO_MANY_REVISIONS"
  );

  const revisions = revisionsResult.rows;

  const activeResult = await client.query(`
    SELECT
      s.active_import_id,
      r.status AS active_status,
      r.source_key AS active_source_key
    FROM special_order_sources s
    LEFT JOIN special_order_import_runs r
      ON r.id = s.active_import_id
    WHERE s.source_key = 'mercedes-txt'
  `);

  assert.ok(activeResult.rows.length <= 1);

  const active = activeResult.rows[0] || null;

  const locksResult = await client.query(`
    SELECT COUNT(*)::integer AS holders
    FROM pg_locks
    WHERE locktype = 'advisory'
      AND granted = true
      AND classid = 204839812
      AND objid = 125
      AND database = (
        SELECT oid
        FROM pg_database
        WHERE datname = current_database()
      )
  `);

  const lockHolders = locksResult.rows[0].holders;

  const entries = readdirSync(ROOT, {
    withFileTypes: true,
  });

  const jobEntries = entries.filter(
    entry => jobPattern.test(entry.name)
  );

  const claimEntries = entries.filter(
    entry => claimPattern.test(entry.name)
  );

  assert.ok(
    jobEntries.length <= 1000,
    "TOO_MANY_JOB_FILES"
  );

  assert.ok(
    claimEntries.length <= 1000,
    "TOO_MANY_CLAIM_FILES"
  );

  const claims = claimEntries.map(entry => {
    const id = entry.name.match(claimPattern)[1];

    const claim = readSecureJson(
      join(ROOT, entry.name)
    );

    assert.equal(claim.fileId, id);

    return claim;
  });

  const jobs = jobEntries.map(entry => {
    const id = entry.name.match(jobPattern)[1];

    const job = readSecureJson(
      join(ROOT, entry.name)
    );

    assert.equal(job.fileId, id);

    return job;
  });

  const report = buildMercedesTxtReconciliationReport({
    revisions,
    jobs,
    claims,
    active,
    lockHolders,
  });

  console.log(
    "DATABASE REVISIONS:", report.databaseRevisions
  );
  console.log(
    "FILESYSTEM JOBS:", report.filesystemJobs
  );
  console.log(
    "WORKER CLAIM FILES:", report.workerClaims
  );
  console.log(
    "ACTIVE IMPORT ID:",
    report.activeImportId ?? "NONE"
  );
  console.log(
    "ADVISORY LOCK HOLDERS:", report.lockHolders
  );

  for (const finding of report.findings) {
    console.log("FINDING:", JSON.stringify(finding));
  }

  console.log(
    "MANUAL REVIEW ITEMS:", report.reviewCount
  );

  console.log("AUDIT RESULT:", report.result);

  console.log(
    "AUDIT NOTE: DATABASE AND FILESYSTEM ARE NOT AN ATOMIC SNAPSHOT"
  );

} finally {
  if (transaction) {
    try {
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  } else {
    await client.end();
  }

  console.log("DATABASE CONNECTION: CLOSED");
}
