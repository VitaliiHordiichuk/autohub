import test from "node:test";
import assert from "node:assert/strict";
import {
  activateMercedesTxtRevision,
  assertMercedesTxtRevisionAlignment,
} from "./SpecialOrderAdminRevisionService.js";

const FILE_ID = "883092b1-e6c1-46cb-b5b3-476f4969ebe6";
const SHA = "1458b65df43b28eb072e2e91ac7676ff1bca1dadcb8dc124f0b943e40bc821b3";
const row = {
  id: 1, source_key: "mercedes-txt", status: "READY",
  total_lines: 1901480, eligible_lines: 1543399, rejected_lines: 358081,
  upload_file_id: FILE_ID, source_sha256: SHA,
};
const job = {
  fileId: FILE_ID, sourceKey: "mercedes-txt",
  status: "READY_NOT_ACTIVATED", importId: 1,
  sha256: SHA, expectedLines: 1901480,
  expectedAccepted: 1543399, expectedUniqueArticles: 1543392,
  expectedPricingConflicts: 6, imported: true, activated: false,
};

function fakeDb({entries = 1543399, unique = 1543392, locked = true} = {}) {
  const calls = [];
  const db = { async query(sql) {
    calls.push(sql);
    if (sql === "BEGIN" || sql === "ROLLBACK" || sql === "COMMIT") return {rows:[]};
    if (sql.includes("pg_try_advisory_xact_lock")) return {rows:[{locked}]};
    if (sql.includes("FROM special_order_import_runs")) return {rows:[row]};
    if (sql.includes("FROM special_order_entries")) return {rows:[{entries,unique_articles:unique}]};
    if (sql.includes("INSERT INTO special_order_sources")) return {rows:[{active_import_id:1}]};
    throw new Error("Unexpected SQL in test: " + sql);
  }};
  return { db, calls };
}
async function withActivation(fn) {
  const prev = process.env.MAKA_TXT_ACTIVATION_ENABLED;
  process.env.MAKA_TXT_ACTIVATION_ENABLED = "true";
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.MAKA_TXT_ACTIVATION_ENABLED;
    else process.env.MAKA_TXT_ACTIVATION_ENABLED = prev;
  }
}
const deps = {importId:1, readJob:async()=>job, readClaim:async()=>true, readSourceIntegrity:async()=>true};

test("activation disabled: never touches DB or job filesystem", async () => {
  const prev = process.env.MAKA_TXT_ACTIVATION_ENABLED;
  process.env.MAKA_TXT_ACTIVATION_ENABLED="false";
  try {
    const { db, calls } = fakeDb();
    let touched = false;
    await assert.rejects(
      activateMercedesTxtRevision({ db, importId:1,
        readJob:async()=>{touched=true;return job;},
        readClaim:async()=>{touched=true;return true;} }),
      /TXT_ACTIVATION_DISABLED/
    );
    assert.equal(calls.length,0);
    assert.equal(touched,false);
  } finally {
    if (prev === undefined) delete process.env.MAKA_TXT_ACTIVATION_ENABLED;
    else process.env.MAKA_TXT_ACTIVATION_ENABLED=prev;
  }
});

test("aligned READY job and DB record activates only under explicit flag", async () => {
  await withActivation(async()=>{
    const {db,calls}=fakeDb();
    const result=await activateMercedesTxtRevision({db,...deps});
    assert.equal(result.activeImportId,1);
    assert.equal(result.eligibleLines,1543399);
    assert.ok(calls.some(sql=>sql.includes("INSERT INTO special_order_sources")));
    assert.equal(calls.at(-1),"COMMIT");
  });
});

test("missing job, SHA mismatch and manual review all fail closed", async () => {
  await withActivation(async()=>{
    for (const variant of [null, {...job,sha256:"a".repeat(64)},
      {...job,requiresManualReview:true},{...job,status:"IMPORTING"},
      {...job,importId:2},{...job,activated:true},
      {...job,expectedAccepted:1},{...job,errorCode:"UNKNOWN"}]) {
      const {db,calls}=fakeDb();
      await assert.rejects(activateMercedesTxtRevision({db,importId:1,
        readJob:async()=>variant,readClaim:async()=>true}), /TXT_RECONCILIATION_REQUIRED/);
      assert.equal(calls.at(-1),"ROLLBACK");
      assert.equal(calls.some(sql=>sql.includes("INSERT INTO special_order_sources")),false);
    }
  });
});

test("missing claim, filesystem error or mismatched counts prevent activation", async () => {
  await withActivation(async()=>{
    for (const claim of [false, null]) {
      const {db,calls}=fakeDb();
      await assert.rejects(activateMercedesTxtRevision({db,importId:1,
        readJob:async()=>job,readClaim:async()=>claim}), /TXT_RECONCILIATION_REQUIRED/);
      assert.equal(calls.at(-1),"ROLLBACK");
    }
    {
      const {db,calls}=fakeDb();
      await assert.rejects(activateMercedesTxtRevision({db,importId:1,
        readJob:async()=>job,readClaim:async()=>{throw new Error("EACCES");}}), /TXT_RECONCILIATION_REQUIRED/);
      assert.equal(calls.at(-1),"ROLLBACK");
    }
    for (const params of [{entries:1543398},{unique:1543391}]) {
      const {db,calls}=fakeDb(params);
      await assert.rejects(activateMercedesTxtRevision({db,...deps}),/row count mismatch/);
      assert.equal(calls.at(-1),"ROLLBACK");
    }
  });
});

test("alignment uses the existing reconciliation classifier", () => {
  assert.deepEqual(assertMercedesTxtRevisionAlignment({row,job,hasClaim:true}),
    {id:1,eligible:1543399,unique:1543392,fileId:FILE_ID});
  assert.throws(()=>assertMercedesTxtRevisionAlignment({row:{...row,source_sha256:"0".repeat(64)},job,hasClaim:true}),
    /TXT_RECONCILIATION_REQUIRED/);
  assert.throws(()=>assertMercedesTxtRevisionAlignment({row:{...row,upload_file_id:undefined},job,hasClaim:true}),
    /TXT_RECONCILIATION_REQUIRED/);
});


test("tampered or inaccessible TXT bytes block activation and force rollback", async () => {
  await withActivation(async () => {
    for (const readSourceIntegrity of [
      async () => false,
      async () => { throw new Error("SOURCE_HASH_MISMATCH"); },
    ]) {
      const { db, calls } = fakeDb();
      await assert.rejects(
        activateMercedesTxtRevision({ db, ...deps, readSourceIntegrity }),
        /TXT_RECONCILIATION_REQUIRED/,
      );
      assert.equal(calls.at(-1), "ROLLBACK");
      assert.equal(calls.some(sql => sql.includes("INSERT INTO special_order_sources")), false);
    }
  });
});
