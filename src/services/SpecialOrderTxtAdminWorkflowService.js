import { getTxtAnalysisStatus } from "./SpecialOrderTxtAnalysisJobService.js";
import { readTxtStageJob } from "./SpecialOrderTxtStageJobService.js";
import { constants } from "node:fs";
import { open, readdir, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { assertProductionTxtUpload, TXT_PRODUCTION_UPLOAD_ROOT as ROOT } from "./SpecialOrderTxtProductionStorageGuard.js";
import { hashTxtSourceFileAt } from "./SpecialOrderTxtSourceIntegrityService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Explicit opt-in for the authenticated admin workflow, never passed to workers.
export function txtAdminWorkflowEnabled(env = process.env) {
  return env.MAKA_TXT_ADMIN_WORKFLOW_ENABLED === "true" &&
    env.NODE_ENV === "production" && env.MAKA_TXT_UPLOAD_MODE === "PRODUCTION_UPLOAD_ONLY" &&
    env.MAKA_TXT_UPLOAD_ROOT === ROOT && env.DB_NAME === "autohub" &&
    env.DB_PORT === "5432" && env.DB_USER === "autohub_app" &&
    ["localhost", "127.0.0.1", "/var/run/postgresql"].includes(env.DB_HOST) &&
    typeof env.DB_PASSWORD === "string" && env.DB_PASSWORD.length > 0;
}

export function txtActivationEnabled(env = process.env) {
  return env.MAKA_TXT_ACTIVATION_ENABLED === "true" || txtAdminWorkflowEnabled(env);
}

async function privateJson(filename) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.size > 65536) {
      throw new Error("INVALID_TXT_METADATA");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally { await handle.close(); }
}

// The server restores the upload on another device or after closing the browser.
// Only upload metadata is returned; no paths, credentials or raw TXT contents.
export async function latestTxtUploadAt(root, requestedFileId) {
  if (requestedFileId !== undefined && !UUID.test(requestedFileId)) throw new Error("INVALID_FILE_ID");
  const candidates = [];
  for (const name of await readdir(root)) {
    const fileId = name.slice(0, -9);
    if (!name.endsWith(".txt.json") || !UUID.test(fileId) || (requestedFileId && fileId !== requestedFileId)) continue;
    try {
      const data = await privateJson(join(root, name));
      const info = await lstat(join(root, `${fileId}.txt`));
      if (data.fileId !== fileId || data.sourceKey !== "mercedes-txt" ||
          data.status !== "UPLOADED_UNVERIFIED" || typeof data.originalName !== "string" ||
          !/^[0-9a-f]{64}$/.test(data.sha256 || "") || !Number.isFinite(Date.parse(data.createdAt)) ||
          !info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() ||
          (info.mode & 0o022) !== 0 || info.size !== data.sizeBytes) continue;
      candidates.push({fileId, originalName:data.originalName, sizeBytes:data.sizeBytes,
        sha256:data.sha256, status:data.status, createdAt:data.createdAt});
    } catch (error) {
      if (["ENOENT", "ELOOP"].includes(error.code) || error.message === "INVALID_TXT_METADATA" || error instanceof SyntaxError) continue;
      throw error;
    }
  }
  candidates.sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.fileId.localeCompare(a.fileId));
  return candidates[0] || null;
}

export async function readTxtAdminWorkflow(fileId) {
  await assertProductionTxtUpload();
  const latestUpload = await latestTxtUploadAt(ROOT, fileId);
  const [analysis, stage] = latestUpload ? await Promise.all([getTxtAnalysisStatus(latestUpload.fileId), readTxtStageJob(latestUpload.fileId)]) : [null, null];
  return {
    capabilities: {
      upload: true,
      import: txtAdminWorkflowEnabled() || process.env.MAKA_TXT_PRODUCTION_IMPORT_ENABLED === "true",
      activate: txtActivationEnabled(),
    },
    latestUpload, analysis, stage,
  };
}

// Only the previously ACTIVE revision is eligible. Keep its SQL data, small
// audit records and job claims; never touch a pending upload or another source.
export async function removeReplacedTxtAt(root, row, activeId) {
  if (row?.source_key !== "mercedes-txt" || row.status !== "READY" ||
      !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 || Number(row.id) >= activeId ||
      !UUID.test(row.upload_file_id || "") || !/^[0-9a-f]{64}$/.test(row.source_sha256 || "")) {
    throw new Error("TXT_CLEANUP_IDENTITY_MISMATCH");
  }
  const file = join(root, `${row.upload_file_id}.txt`);
  let info;
  try { info = await lstat(file); }
  catch (error) { if (error.code === "ENOENT") return {status:"ALREADY_REMOVED", deletedBytes:0}; throw error; }
  const metadata = await privateJson(`${file}.json`);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o022) !== 0 ||
      metadata.fileId !== row.upload_file_id || metadata.sourceKey !== "mercedes-txt" ||
      metadata.sha256 !== row.source_sha256 || metadata.sizeBytes !== info.size) {
    throw new Error("TXT_CLEANUP_IDENTITY_MISMATCH");
  }
  if (await hashTxtSourceFileAt(root, row.upload_file_id) !== row.source_sha256) {
    throw new Error("TXT_CLEANUP_IDENTITY_MISMATCH");
  }
  const current = await lstat(file);
  if (current.ino !== info.ino || current.dev !== info.dev || current.size !== info.size || current.mtimeMs !== info.mtimeMs || current.ctimeMs !== info.ctimeMs) {
    throw new Error("TXT_CLEANUP_IDENTITY_MISMATCH");
  }
  await unlink(file);
  return {status:"REMOVED", deletedBytes:info.size};
}

export async function cleanupReplacedTxt({ db, activeId, previousId }) {
  if (previousId === null || previousId === activeId) return {status:"NOT_REQUIRED", deletedBytes:0};
  await assertProductionTxtUpload();
  let transaction = false;
  try {
    await db.query("BEGIN"); transaction = true;
    const lock = await db.query("SELECT pg_try_advisory_xact_lock(204839812, 125) AS locked");
    if (lock.rows[0]?.locked !== true) throw new Error("TXT_CLEANUP_BUSY");
    const active = await db.query("SELECT s.active_import_id, r.upload_file_id FROM special_order_sources s JOIN special_order_import_runs r ON r.id=s.active_import_id AND r.source_key=s.source_key WHERE s.source_key = 'mercedes-txt' FOR UPDATE OF s");
    if (Number(active.rows[0]?.active_import_id) !== activeId) throw new Error("TXT_CLEANUP_ACTIVE_CHANGED");
    const old = await db.query("SELECT id, source_key, status, upload_file_id, source_sha256 FROM special_order_import_runs WHERE id = $1", [previousId]);
    if (!UUID.test(active.rows[0]?.upload_file_id || "") || old.rows[0]?.upload_file_id === active.rows[0].upload_file_id) throw new Error("TXT_CLEANUP_ACTIVE_FILE_PROTECTED");
    const result = await removeReplacedTxtAt(ROOT, old.rows[0], activeId);
    await db.query("COMMIT"); transaction = false;
    return result;
  } catch (error) {
    if (transaction) await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
