import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TXT_PRODUCTION_UPLOAD_ROOT } from "./SpecialOrderTxtProductionStorageGuard.js";
import { classifyMercedesTxtReconciliation } from "./SpecialOrderTxtReconciliationService.js";
import { assertProductionTxtSourceIntegrity } from "./SpecialOrderTxtSourceIntegrityService.js";

const SOURCE_KEY = "mercedes-txt";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function validId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError("Invalid TXT import ID");
  }
  return id;
}

function requireDb(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("Database client required");
  }
}

// Dynamic import keeps the activation-disabled path completely independent
// of the upload filesystem and avoids contacting it before permission checks.
async function readProductionJob(fileId) {
  const { readTxtStageJob } = await import("./SpecialOrderTxtStageJobService.js");
  return readTxtStageJob(fileId);
}

async function verifyProductionClaim(fileId) {
  const filename = join(
    TXT_PRODUCTION_UPLOAD_ROOT,
    `${fileId}.txt.stage.claim.json`
  );
  const info = await lstat(filename);
  if (
    !info.isFile() || info.isSymbolicLink() ||
    (info.mode & 0o777) !== 0o600 ||
    info.uid !== process.getuid()
  ) {
    throw new Error("TXT_RECONCILIATION_REQUIRED");
  }
  const claim = JSON.parse(await readFile(filename, "utf8"));
  if (claim?.fileId !== fileId || claim?.sourceKey !== SOURCE_KEY) {
    throw new Error("TXT_RECONCILIATION_REQUIRED");
  }
  return true;
}

function validCount(value, { positive = false } = {}) {
  const number = Number(value);
  return Number.isSafeInteger(number) &&
    (positive ? number > 0 : number >= 0) ? number : null;
}

// All preactivation signals must match, not just the SQL READY flag.
// This function is pure and can be tested without a live database.
export function assertMercedesTxtRevisionAlignment({ row, job, hasClaim }) {
  const id = validCount(row?.id, { positive: true });
  const fileId = row?.upload_file_id;
  const sha256 = row?.source_sha256;
  const eligible = validCount(row?.eligible_lines, { positive: true });
  const total = validCount(row?.total_lines, { positive: true });
  const rejected = validCount(row?.rejected_lines);
  const unique = validCount(job?.expectedUniqueArticles, { positive: true });
  const conflicts = validCount(job?.expectedPricingConflicts);

  if (
    id == null || row?.source_key !== SOURCE_KEY || row?.status !== "READY" ||
    typeof fileId !== "string" || !UUID_V4.test(fileId) ||
    typeof sha256 !== "string" || !SHA256.test(sha256) ||
    eligible == null || total == null || rejected == null ||
    eligible + rejected !== total ||
    unique == null || unique > eligible || conflicts == null ||
    job?.status !== "READY_NOT_ACTIVATED" ||
    job?.imported !== true || job?.activated !== false ||
    job?.requiresManualReview === true || job?.errorCode != null ||
    Number(job?.importId) !== id ||
    Number(job?.expectedAccepted) !== eligible ||
    Number(job?.expectedLines) !== total ||
    hasClaim !== true
  ) {
    throw new Error("TXT_RECONCILIATION_REQUIRED");
  }

  const assessment = classifyMercedesTxtReconciliation({
    job,
    revision: {
      id,
      status: row.status,
      file_id: fileId,
      source_sha256: sha256,
    },
    hasClaim,
  });
  if (assessment !== "READY_ALIGNED") {
    throw new Error("TXT_RECONCILIATION_REQUIRED");
  }
  return { id, eligible, unique, fileId };
}

export async function listMercedesTxtRevisions(db) {
  requireDb(db);
  const result = await db.query(`
    SELECT r.id, r.status, r.total_lines, r.eligible_lines,
      r.rejected_lines, r.started_at, r.finished_at,
      COALESCE(s.active_import_id = r.id, FALSE) AS is_active
    FROM special_order_import_runs r
    LEFT JOIN special_order_sources s
      ON s.source_key = r.source_key
    WHERE r.source_key = $1
    ORDER BY r.id DESC LIMIT 50
  `, [SOURCE_KEY]);
  return result.rows;
}

export async function activateMercedesTxtRevision({
  db,
  importId,
  // Test-only dependency injection. Neither dependency bypasses the
  // activation env gate, SQL lock, row checks, or reconciliation checks.
  readJob = readProductionJob,
  readClaim = verifyProductionClaim,
  // Test-only dependency. Production always hashes the original TXT file.
  readSourceIntegrity = assertProductionTxtSourceIntegrity,
}) {
  // Import permission is independent from publication permission.
  // Never access DB or files when activation is disabled.
  if (process.env.MAKA_TXT_ACTIVATION_ENABLED !== "true") {
    throw new Error("TXT_ACTIVATION_DISABLED");
  }
  requireDb(db);
  const id = validId(importId);
  let transactionStarted = false;
  try {
    await db.query("BEGIN");
    transactionStarted = true;
    const lock = await db.query(`
      SELECT pg_try_advisory_xact_lock(204839812, 125) AS locked
    `);
    if (lock.rows[0]?.locked !== true) {
      throw new Error("TXT import currently in progress");
    }
    const revision = await db.query(`
      SELECT id, source_key, status, eligible_lines, rejected_lines,
        total_lines, upload_file_id, source_sha256
      FROM special_order_import_runs
      WHERE id = $1 FOR UPDATE
    `, [id]);
    const row = revision.rows[0];
    if (!row || row.source_key !== SOURCE_KEY || row.status !== "READY") {
      throw new Error("TXT revision is not ready for activation");
    }
    if (typeof row.upload_file_id !== "string" ||
        !UUID_V4.test(row.upload_file_id)) {
      throw new Error("TXT_RECONCILIATION_REQUIRED");
    }

    // SQL transaction + advisory lock are retained while checking the
    // immutable worker job, permanent claim, SHA and audited row counts.
    let job, hasClaim;
    try {
      [job, hasClaim] = await Promise.all([
        readJob(row.upload_file_id),
        readClaim(row.upload_file_id),
      ]);
    } catch {
      throw new Error("TXT_RECONCILIATION_REQUIRED");
    }
    const aligned = assertMercedesTxtRevisionAlignment({row, job, hasClaim});

    // Hash the uploaded source itself while the activation transaction is locked.
    // Both saved hashes matching is insufficient if the file was modified.
    let sourceVerified;
    try {
      sourceVerified = await readSourceIntegrity(aligned.fileId, row.source_sha256);
    } catch {
      throw new Error("TXT_RECONCILIATION_REQUIRED");
    }
    if (sourceVerified !== true) {
      throw new Error("TXT_RECONCILIATION_REQUIRED");
    }

    const stored = await db.query(`
      SELECT COUNT(*)::bigint AS entries,
        COUNT(DISTINCT article_normalized)::bigint AS unique_articles
      FROM special_order_entries WHERE import_id = $1
    `, [id]);
    const actual = validCount(stored.rows[0]?.entries, { positive: true });
    const actualUnique = validCount(stored.rows[0]?.unique_articles, { positive: true });
    if (actual !== aligned.eligible || actualUnique !== aligned.unique) {
      throw new Error("TXT revision row count mismatch");
    }

    const updated = await db.query(`
      INSERT INTO special_order_sources (source_key, active_import_id)
      VALUES ($1, $2)
      ON CONFLICT (source_key)
      DO UPDATE SET active_import_id = EXCLUDED.active_import_id
      RETURNING active_import_id
    `, [SOURCE_KEY, id]);
    if (Number(updated.rows[0]?.active_import_id) !== id) {
      throw new Error("TXT active revision confirmation failed");
    }
    await db.query("COMMIT");
    transactionStarted = false;
    return {
      sourceKey: SOURCE_KEY,
      activeImportId: id,
      eligibleLines: aligned.eligible,
      status: "ACTIVE",
    };
  } catch (error) {
    if (transactionStarted) {
      try { await db.query("ROLLBACK"); } catch { /* preserve original */ }
    }
    throw error;
  }
}
