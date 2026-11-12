/**
 * MAKA Mercedes TXT worker lifecycle.
 *
 * No database configuration or filesystem paths.
 * All I/O is supplied by the protected caller.
 *
 * The production worker must validate environment,
 * storage, job identity and claim BEFORE calling this.
 *
 * No automatic retry or activation.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function runMercedesTxtWorkerCore({
  fileId,
  job,
  makePlan,
  jobMatchesPlan,
  transitionJob,
  executeImport,
  resultMatchesPlan,
  heartbeatMs = 20000,
} = {}) {
  if (
    !UUID.test(fileId || "") ||
    job?.fileId !== fileId ||
    job?.status !== "QUEUED"
  ) {
    throw new Error("STAGE_JOB_NOT_QUEUED");
  }

  if (
    ![
      makePlan,
      jobMatchesPlan,
      transitionJob,
      executeImport,
      resultMatchesPlan,
    ].every(fn => typeof fn === "function") ||
    !Number.isSafeInteger(heartbeatMs) ||
    heartbeatMs < 1000
  ) {
    throw new Error("INVALID_WORKER_CORE_DEPENDENCIES");
  }

  let importMayHaveCommitted = false;
  let heartbeatError = null;
  let heartbeatChain = Promise.resolve();
  let timer = null;

  try {
    const plan = await makePlan(fileId);

    if (!jobMatchesPlan(job, plan)) {
      throw new Error("PRODUCTION_STAGE_PLAN_MISMATCH");
    }

    await transitionJob(fileId, "IMPORTING");

    // From this point, the database outcome may be
    // unknown after an error or process interruption.
    importMayHaveCommitted = true;

    timer = setInterval(() => {
      heartbeatChain = heartbeatChain.then(async () => {
        if (heartbeatError) return;

        try {
          await transitionJob(fileId, "IMPORTING");
        } catch (error) {
          heartbeatError = error;
        }
      });
    }, heartbeatMs);

    let result;

    try {
      result = await executeImport(fileId);
    } finally {
      clearInterval(timer);
      timer = null;
      await heartbeatChain;
    }

    if (heartbeatError) {
      throw new Error("PRODUCTION_STAGE_HEARTBEAT_FAILED");
    }

    if (!resultMatchesPlan(result, plan)) {
      throw new Error("PRODUCTION_STAGE_RESULT_MISMATCH");
    }

    return await transitionJob(
      fileId,
      "READY_NOT_ACTIVATED",
      {
        importId: result.importId,
        imported: true,
        activated: false,
        rejectionReasons: result.rejectionReasons || {},
      }
    );
  } catch (error) {
    if (timer !== null) {
      clearInterval(timer);
    }

    await heartbeatChain.catch(() => {});

    try {
      if (importMayHaveCommitted) {
        // Do NOT claim the database import failed.
        // It may already be READY in PostgreSQL.
        await transitionJob(fileId, "IMPORTING", {
          requiresManualReview: true,
          activated: false,
          errorCode:
            "STAGE_RESULT_UNKNOWN_MANUAL_REVIEW",
        });
      } else {
        // The importer has not been invoked.
        await transitionJob(fileId, "FAILED", {
          imported: false,
          activated: false,
          requiresManualReview: true,
          errorCode: "PRODUCTION_STAGE_PREIMPORT_FAILED",
        });
      }
    } catch {
      // Preserve the original exception.
      // The reconciliation auditor must inspect
      // any unresolved filesystem/database mismatch.
    }

    throw error;
  }
}
