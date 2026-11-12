/**
 * MAKA Mercedes TXT reconciliation classifier.
 *
 * Pure function:
 * - no database connections
 * - no filesystem access
 * - no status updates
 * - no automatic retries
 * - no activation
 *
 * Uses a caller-provided PostgreSQL revision snapshot and
 * filesystem job snapshot.
 *
 * Does not verify the active revision pointer.
 */

const JOB_STATUSES = new Set([
  "QUEUED",
  "IMPORTING",
  "READY_NOT_ACTIVATED",
  "FAILED",
]);

const DB_STATUSES = new Set([
  "IMPORTING",
  "READY",
  "FAILED",
]);

const SHA = /^[0-9a-f]{64}$/;

export function classifyMercedesTxtReconciliation({
  job = null,
  revision = null,
  hasClaim = false,
  now = Date.now(),
  staleAfterMs = 180000,
} = {}) {
  if (
    !Number.isFinite(now) ||
    !Number.isSafeInteger(staleAfterMs) ||
    staleAfterMs < 1000 ||
    typeof hasClaim !== "boolean"
  ) {
    throw new Error("INVALID_RECONCILIATION_OPTIONS");
  }

  if (!job && !revision) {
    return hasClaim
      ? "ORPHAN_CLAIM_REVIEW"
      : "EMPTY";
  }

  if (!job) {
    return hasClaim
      ? "ORPHAN_CLAIM_REVIEW"
      : "DATABASE_ONLY_REVIEW";
  }

  if (!JOB_STATUSES.has(job.status)) {
    return "UNKNOWN_JOB_STATUS_REVIEW";
  }

  if (!revision) {
    if (job.status === "QUEUED" && !hasClaim) {
      return "QUEUED_NOT_STARTED";
    }

    if (job.status === "FAILED") {
      return "FAILED_BEFORE_DATABASE_REVIEW";
    }

    return "JOB_WITHOUT_DATABASE_REVIEW";
  }

  if (!DB_STATUSES.has(revision.status)) {
    return "UNKNOWN_DB_STATUS_REVIEW";
  }

  if (
    typeof revision.file_id !== "string" ||
    revision.file_id.length === 0
  ) {
    return "DB_FILE_ID_MISSING_REVIEW";
  }

  if (job.fileId !== revision.file_id) {
    return "FILE_ID_MISMATCH";
  }

  if (job.importId != null) {
    const importId = Number(job.importId);
    const revisionId = Number(revision.id);

    if (
      !Number.isSafeInteger(importId) ||
      importId <= 0 ||
      !Number.isSafeInteger(revisionId) ||
      importId !== revisionId
    ) {
      return "IMPORT_ID_MISMATCH";
    }
  }

  if (
    typeof job.sha256 !== "string" ||
    typeof revision.source_sha256 !== "string" ||
    !SHA.test(job.sha256) ||
    !SHA.test(revision.source_sha256)
  ) {
    return "SHA_MISSING_OR_INVALID_REVIEW";
  }

  if (job.sha256 !== revision.source_sha256) {
    return "SHA_MISMATCH";
  }

  if (revision.status === "READY") {
    if (job.status === "FAILED") {
      return "CRITICAL_DB_READY_JOB_FAILED";
    }

    if (job.status === "IMPORTING") {
      return "CRITICAL_DB_READY_JOB_IMPORTING";
    }

    if (job.status === "READY_NOT_ACTIVATED") {
      if (job.importId == null) {
        return "IMPORT_ID_MISSING_REVIEW";
      }

      return hasClaim
        ? "READY_ALIGNED"
        : "READY_MISSING_CLAIM_REVIEW";
    }
  }

  if (revision.status === "FAILED") {
    if (job.status === "READY_NOT_ACTIVATED") {
      return "CRITICAL_JOB_READY_DB_FAILED";
    }

    if (job.status === "FAILED") {
      return hasClaim
        ? "FAILED_ALIGNED"
        : "FAILED_CLAIM_MISSING_REVIEW";
    }
  }

  if (
    revision.status === "IMPORTING" &&
    job.status === "IMPORTING"
  ) {
    if (!hasClaim) {
      return "IMPORTING_MISSING_CLAIM_REVIEW";
    }

    const updated = Date.parse(job.updatedAt || "");

    if (!Number.isFinite(updated)) {
      return "INVALID_HEARTBEAT_REVIEW";
    }

    if (updated - now > 60000) {
      return "FUTURE_HEARTBEAT_REVIEW";
    }

    if (now - updated > staleAfterMs) {
      return "STALE_IMPORTING_REVIEW";
    }

    // A recent heartbeat does not prove the worker is alive.
    return "IMPORTING_MONITOR";
  }

  return "STATUS_MISMATCH_REVIEW";
}
