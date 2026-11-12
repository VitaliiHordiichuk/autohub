// Processes one queued deletion, with both a DB lock and a filesystem safety check.
// Importing this module has no side effects. Run it only from a dedicated worker.
import { lstat, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";

export const TXT_CLEANUP_ROOT =
  "/home/ubuntu/maka-mercedes-txt-prod-uploads-20261110";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KEY = "mercedes-txt";

async function finish(db, jobId, status, errorCode = null) {
  await db.query(`
    UPDATE special_order_txt_cleanup_jobs
    SET status = $2,
        attempts = attempts + 1,
        last_error_code = $3,
        next_attempt_at = CASE
          WHEN $2 = 'RETRY' THEN NOW() + INTERVAL '10 minutes'
          ELSE next_attempt_at
        END,
        updated_at = NOW(),
        completed_at = CASE
          WHEN $2 IN ('DONE', 'SKIPPED') THEN NOW()
          ELSE NULL
        END
    WHERE id = $1
  `, [jobId, status, errorCode]);
  return { status, errorCode };
}

export async function processNextTxtCleanup({
  db,
  root = TXT_CLEANUP_ROOT,
  io = { lstat, realpath, unlink },
  allowTestRoot = false,
} = {}) {
  if (!db || typeof db.query !== "function") {
    throw new Error("TXT_CLEANUP_DB_REQUIRED");
  }
  if (!allowTestRoot && root !== TXT_CLEANUP_ROOT) {
    throw new Error("TXT_CLEANUP_UNTRUSTED_ROOT");
  }

  let transactionStarted = false;
  try {
    await db.query("BEGIN");
    transactionStarted = true;

    // Activation uses the same advisory lock. Prevent an active revision switch
    // from racing with a filesystem deletion.
    const lock = await db.query(
      "SELECT pg_try_advisory_xact_lock(204839812, 125) AS locked"
    );
    if (lock.rows[0]?.locked !== true) {
      await db.query("ROLLBACK");
      transactionStarted = false;
      return { status: "BUSY" };
    }

    const claimed = await db.query(`
      SELECT id, source_key, old_import_id,
             activated_import_id, old_upload_file_id
      FROM special_order_txt_cleanup_jobs
      WHERE status IN ('PENDING', 'RETRY')
        AND next_attempt_at <= NOW()
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const job = claimed.rows[0];
    if (!job) {
      await db.query("COMMIT");
      transactionStarted = false;
      return { status: "IDLE" };
    }

    let result;
    if (
      job.source_key !== SOURCE_KEY ||
      !UUID_V4.test(String(job.old_upload_file_id || "")) ||
      String(job.old_import_id) === String(job.activated_import_id)
    ) {
      result = await finish(db, job.id, "SKIPPED", "INVALID_JOB");
    } else {
      const state = await db.query(`
        SELECT s.active_import_id,
               old.upload_file_id AS old_file_id,
               old.status AS old_status,
               active.upload_file_id AS active_file_id,
               active.status AS active_status
        FROM special_order_sources s
        JOIN special_order_import_runs old
          ON old.id = $2 AND old.source_key = s.source_key
        JOIN special_order_import_runs active
          ON active.id = s.active_import_id
         AND active.source_key = s.source_key
        WHERE s.source_key = $1
        FOR UPDATE OF s
      `, [SOURCE_KEY, job.old_import_id]);
      const row = state.rows[0];

      if (
        !row ||
        String(row.old_file_id || "").toLowerCase() !==
          String(job.old_upload_file_id).toLowerCase() ||
        row.old_status !== "READY" ||
        row.active_status !== "READY"
      ) {
        result = await finish(db, job.id, "SKIPPED", "REVISION_MISMATCH");
      } else if (String(row.active_import_id) === String(job.old_import_id)) {
        // A rollback to the previous revision must preserve its source file.
        result = await finish(db, job.id, "RETRY", "OLD_REVISION_ACTIVE");
      } else if (
        String(row.active_file_id).toLowerCase() ===
        String(job.old_upload_file_id).toLowerCase()
      ) {
        result = await finish(db, job.id, "SKIPPED", "ACTIVE_FILE_SHARED");
      } else {
        // Preserve sources referenced by ANY other revision, even an inactive
        // one. A later rollback/activation may still depend on that file.
        const refs = await db.query(`
          SELECT EXISTS (
            SELECT 1 FROM special_order_import_runs
            WHERE source_key = $1
              AND upload_file_id = $2::uuid
              AND id <> $3
          ) AS shared
        `, [SOURCE_KEY, job.old_upload_file_id, job.old_import_id]);

        if (refs.rows[0]?.shared !== false) {
          result = await finish(db, job.id, "SKIPPED", "SOURCE_REFERENCED");
        } else {
          // No file path is taken from the DB. Only the validated UUID is
          // appended to the pinned upload directory.
          const filename = join(root, `${job.old_upload_file_id}.txt`);
          let unsafe = false;
          let removed = false;
          let ioError = false;

          try {
            const dir = await io.lstat(root);
            if (
              !dir.isDirectory() ||
              dir.isSymbolicLink() ||
              await io.realpath(root) !== root
            ) {
              unsafe = true;
            } else {
              try {
                const file = await io.lstat(filename);
                if (
                  !file.isFile() ||
                  file.isSymbolicLink() ||
                  file.uid !== process.getuid()
                ) {
                  unsafe = true;
                } else {
                  try {
                    await io.unlink(filename);
                    removed = true;
                  } catch (error) {
                    if (error?.code === "ENOENT") removed = true;
                    else ioError = true;
                  }
                }
              } catch (error) {
                if (error?.code === "ENOENT") removed = true;
                else ioError = true;
              }
            }
          } catch {
            ioError = true;
          }

          result = unsafe
            ? await finish(db, job.id, "SKIPPED", "UNSAFE_PATH")
            : ioError
              ? await finish(db, job.id, "RETRY", "FILE_IO_ERROR")
              : removed
                ? await finish(db, job.id, "DONE")
                : await finish(db, job.id, "RETRY", "FILE_IO_ERROR");
        }
      }
    }

    await db.query("COMMIT");
    transactionStarted = false;
    return { ...result, jobId: job.id };
  } catch (error) {
    if (transactionStarted) {
      try { await db.query("ROLLBACK"); } catch { /* preserve original */ }
    }
    throw error;
  }
}
