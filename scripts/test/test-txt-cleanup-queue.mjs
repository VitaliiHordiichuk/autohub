// Mock-only tests. No production DB, Telegram, or upload directory is accessed.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, access, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  processNextTxtCleanup
} from "../../src/services/SpecialOrderTxtCleanupQueueService.js";

const OLD = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";
const root = await mkdtemp(join(tmpdir(), "maka-txt-cleanup-queue-"));
const oldFile = join(root, `${OLD}.txt`);
const newFile = join(root, `${NEW}.txt`);

function mockDb({
  job = {},
  activeImportId = "2",
  activeFileId = NEW,
  oldFileId = OLD,
  oldStatus = "READY",
  activeStatus = "READY",
  shared = false,
  busy = false,
} = {}) {
  const db = {
    finishes: [],
    actions: [],
    async query(sql, params = []) {
      db.actions.push(sql.trim().split(/\s+/)[0]);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: !busy }] };
      }
      if (sql.includes("FROM special_order_txt_cleanup_jobs")) {
        if (job === null) return { rows: [] };
        return {
          rows: [{
            id: "100",
            source_key: "mercedes-txt",
            old_import_id: "1",
            activated_import_id: "2",
            old_upload_file_id: OLD,
            ...job,
          }],
        };
      }
      if (sql.includes("FROM special_order_sources s")) {
        return {
          rows: [{
            active_import_id: activeImportId,
            old_file_id: oldFileId,
            old_status: oldStatus,
            active_file_id: activeFileId,
            active_status: activeStatus,
          }],
        };
      }
      if (sql.includes("SELECT EXISTS")) {
        return { rows: [{ shared }] };
      }
      if (sql.includes("UPDATE special_order_txt_cleanup_jobs")) {
        db.finishes.push({
          id: params[0], status: params[1], errorCode: params[2]
        });
        return { rows: [] };
      }
      throw new Error("UNEXPECTED MOCK SQL");
    }
  };
  return db;
}

async function run(opts = {}) {
  const db = mockDb(opts);
  const result = await processNextTxtCleanup({
    db, root, allowTestRoot: true
  });
  assert.equal(db.actions[0], "BEGIN");
  assert.equal(db.actions.at(-1), result.status === "BUSY" ? "ROLLBACK" : "COMMIT");
  if (db.finishes.length) {
    assert.equal(db.finishes.length, 1);
    assert.equal(db.finishes[0].status, result.status);
  }
  return result;
}

try {
  await writeFile(oldFile, "OLD TEST DATA");
  await writeFile(newFile, "NEW TEST DATA");

  assert.equal((await run({job: null})).status, "IDLE");
  assert.equal((await run({busy: true})).status, "BUSY");
  console.log("EMPTY QUEUE AND ADVISORY LOCK: PASS");

  assert.equal(
    (await run({activeImportId: "1", activeFileId: OLD})).status,
    "RETRY"
  );
  await access(oldFile);
  console.log("ACTIVE PREVIOUS REVISION IS PROTECTED: PASS");

  assert.equal(
    (await run({activeFileId: OLD})).status, "SKIPPED"
  );
  await access(oldFile);
  console.log("ACTIVE SHARED SOURCE IS PROTECTED: PASS");

  assert.equal(
    (await run({shared: true})).status, "SKIPPED"
  );
  await access(oldFile);
  console.log("ANY OTHER REVISION SHARING SOURCE IS PROTECTED: PASS");

  assert.equal(
    (await run({activeStatus: "IMPORTING"})).status, "SKIPPED"
  );
  assert.equal(
    (await run({activeFileId: null})).status, "SKIPPED"
  );
  await access(oldFile);
  console.log("UNREADY OR UNIDENTIFIED ACTIVE SOURCE IS PROTECTED: PASS");

  assert.equal((await run()).status, "DONE");
  await assert.rejects(access(oldFile), { code: "ENOENT" });
  await access(newFile);
  console.log("ONLY SUPERSEDED SOURCE IS DELETED: PASS");

  assert.equal((await run()).status, "DONE");
  console.log("CRASH/RETRY AFTER UNLINK IS IDEMPOTENT: PASS");

  await symlink(newFile, oldFile);
  assert.equal((await run()).status, "SKIPPED");
  await access(newFile);
  console.log("SYMLINK SOURCE IS PROTECTED: PASS");
  await rm(oldFile);

  await writeFile(oldFile, "OLD TEST DATA");
  const db = mockDb();
  const failure = await processNextTxtCleanup({
    db, root, allowTestRoot: true,
    io: {
      lstat: (await import("node:fs/promises")).lstat,
      realpath: (await import("node:fs/promises")).realpath,
      unlink: async () => {
        const error = new Error("test transient failure");
        error.code = "EBUSY";
        throw error;
      }
    }
  });
  assert.equal(failure.status, "RETRY");
  assert.equal(db.finishes[0].errorCode, "FILE_IO_ERROR");
  await access(oldFile);
  console.log("FILESYSTEM FAILURE KEEPS OLD SOURCE FOR RETRY: PASS");

  console.log("=== TXT CLEANUP QUEUE MOCK TESTS: PASS ===");
} finally {
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
