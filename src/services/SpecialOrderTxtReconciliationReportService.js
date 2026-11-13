/**
 * MAKA Mercedes TXT reconciliation report.
 *
 * Pure snapshot evaluation.
 * No database queries, filesystem access,
 * imports, activation, or automatic repairs.
 */

import {
  classifyMercedesTxtReconciliation,
} from "./SpecialOrderTxtReconciliationService.js";

const benign = new Set([
  "EMPTY",
  "READY_ALIGNED",
  "FAILED_ALIGNED",
  "QUEUED_NOT_STARTED",
  "IMPORTING_MONITOR",
]);

export function buildMercedesTxtReconciliationReport({
  revisions = [],
  jobs = [],
  claims = [],
  active = null,
  lockHolders = 0,
  now = Date.now(),
} = {}) {
  if (
    !Array.isArray(revisions) ||
    !Array.isArray(jobs) ||
    !Array.isArray(claims) ||
    revisions.length > 1000 ||
    jobs.length > 1000 ||
    claims.length > 1000 ||
    !Number.isSafeInteger(lockHolders) ||
    lockHolders < 0 ||
    !Number.isFinite(now)
  ) {
    throw new Error("INVALID_RECONCILIATION_SNAPSHOT");
  }

  const byFileId = new Map();
  const jobIds = new Set();
  const claimIds = new Set();
  const findings = [];

  function addFinding(data) {
    findings.push(data);
  }

  for (const revision of revisions) {
    if (!revision || typeof revision !== "object") {
      throw new Error("INVALID_DATABASE_REVISION");
    }

    if (revision.file_id != null) {
      if (
        typeof revision.file_id !== "string" ||
        byFileId.has(revision.file_id)
      ) {
        throw new Error("DUPLICATE_OR_INVALID_DB_FILE_ID");
      }

      byFileId.set(revision.file_id, revision);
    }
  }

  for (const claim of claims) {
    const id = claim?.fileId;

    if (
      typeof id !== "string" ||
      claimIds.has(id)
    ) {
      throw new Error("DUPLICATE_OR_INVALID_CLAIM");
    }

    claimIds.add(id);
  }

  for (const job of jobs) {
    const id = job?.fileId;

    if (
      typeof id !== "string" ||
      jobIds.has(id)
    ) {
      throw new Error("DUPLICATE_OR_INVALID_JOB");
    }

    jobIds.add(id);

    const revision = byFileId.get(id) ?? null;
    const hasClaim = claimIds.has(id);

    addFinding({
      fileId: id,
      importId: revision?.id ?? null,
      jobStatus: job.status,
      databaseStatus: revision?.status ?? null,
      hasClaim,
      assessment: classifyMercedesTxtReconciliation({
        job,
        revision,
        hasClaim,
        now,
      }),
    });
  }

  for (const revision of revisions) {
    if (
      revision.file_id &&
      jobIds.has(revision.file_id)
    ) {
      continue;
    }

    addFinding({
      fileId: revision.file_id ?? null,
      importId: revision.id,
      databaseStatus: revision.status,
      assessment: classifyMercedesTxtReconciliation({
        revision,
        now,
      }),
    });
  }

  for (const id of claimIds) {
    if (jobIds.has(id)) continue;

    addFinding({
      fileId: id,
      assessment: classifyMercedesTxtReconciliation({
        hasClaim: true,
        now,
      }),
    });
  }

  if (
    active?.active_import_id != null &&
    (
      active.active_status !== "READY" ||
      active.active_source_key !== "mercedes-txt"
    )
  ) {
    addFinding({
      importId: active.active_import_id,
      assessment: "CRITICAL_ACTIVE_POINTER_INVALID",
    });
  }

  const importingJobs = findings.filter(
    finding => finding.jobStatus === "IMPORTING"
  );

  // An advisory lock without an importing job needs review.
  if (lockHolders > 0 && importingJobs.length === 0) {
    addFinding({
      lockHolders,
      assessment: "ADVISORY_LOCK_WITHOUT_IMPORTING_JOB_REVIEW",
    });
  }

  // A recent heartbeat alone cannot prove the importer
  // is still running when its DB lock is absent.
  if (lockHolders === 0) {
    for (const finding of importingJobs) {
      if (finding.assessment === "IMPORTING_MONITOR") {
        finding.assessment =
          "IMPORTING_WITHOUT_ADVISORY_LOCK_REVIEW";
      }
    }
  }

  const reviewCount = findings.filter(
    finding => !benign.has(finding.assessment)
  ).length;

  let result;

  if (reviewCount > 0) {
    result = "MANUAL_REVIEW_REQUIRED";
  } else if (
    revisions.length === 0 &&
    jobs.length === 0 &&
    claims.length === 0 &&
    active?.active_import_id == null &&
    lockHolders === 0
  ) {
    result = "EMPTY_AND_CONSISTENT";
  } else {
    result = "NO_CLASSIFIED_MISMATCHES_AT_SNAPSHOT";
  }

  return {
    databaseRevisions: revisions.length,
    filesystemJobs: jobs.length,
    workerClaims: claims.length,
    activeImportId: active?.active_import_id ?? null,
    lockHolders,
    findings,
    reviewCount,
    result,
  };
}
