import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";

import {
  assertTxtUploadStage,
  TXT_UPLOAD_ROOT,
  TXT_UPLOAD_MAX_BYTES,
} from "./SpecialOrderTxtBrowserUploadService.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validAuditedFileId(id) {
  return typeof id === "string" && UUID.test(id);
}

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function validCount(n) {
  return Number.isSafeInteger(n) && n >= 0;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function fileHash(filename) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export async function createAuditedStagePlan(fileId) {
  required(validAuditedFileId(fileId), "INVALID_FILE_ID");

  await assertTxtUploadStage();

  const filename = join(TXT_UPLOAD_ROOT, `${fileId}.txt`);
  const actual = await realpath(filename);
  const info = await lstat(filename);

  required(
    actual === filename &&
    info.isFile() &&
    !info.isSymbolicLink() &&
    info.size >= 100 &&
    info.size <= TXT_UPLOAD_MAX_BYTES,
    "INVALID_UPLOAD_FILE"
  );

  const [upload, preview, audit, analysis] =
    await Promise.all([
      readJson(`${filename}.json`),
      readJson(`${filename}.preview.json`),
      readJson(`${filename}.audit.json`),
      readJson(`${filename}.analysis.json`),
    ]);

  const sha = upload.sha256;

  required(
    upload.fileId === fileId &&
    upload.sourceKey === "mercedes-txt" &&
    upload.status === "UPLOADED_UNVERIFIED" &&
    upload.sizeBytes === info.size &&
    typeof sha === "string" &&
    /^[0-9a-f]{64}$/.test(sha),
    "UPLOAD_METADATA_MISMATCH"
  );

  required(
    preview.fileId === fileId &&
    preview.sourceKey === "mercedes-txt" &&
    preview.status === "PREVIEWED_NOT_IMPORTED" &&
    preview.encoding === "windows-1251" &&
    preview.fileSizeBytes === info.size &&
    preview.sha256 === sha,
    "PREVIEW_REPORT_MISMATCH"
  );

  required(
    audit.fileId === fileId &&
    audit.sourceKey === "mercedes-txt" &&
    audit.status === "AUDITED_NOT_IMPORTED" &&
    audit.imported === false &&
    audit.encoding === "windows-1251" &&
    audit.fileSizeBytes === info.size &&
    audit.sha256 === sha,
    "AUDIT_REPORT_MISMATCH"
  );

  required(
    analysis.fileId === fileId &&
    analysis.sourceKey === "mercedes-txt" &&
    analysis.status === "AUDITED_NOT_IMPORTED" &&
    analysis.imported === false &&
    analysis.sha256 === sha,
    "ANALYSIS_STATUS_MISMATCH"
  );

  const total = audit.totalLines;
  const accepted = audit.accepted;
  const rejected = audit.rejected;
  const unique = audit.uniqueArticles;
  const conflicts = audit.pricingConflicts;

  required(
    [total, accepted, rejected, unique, conflicts]
      .every(validCount) &&
    total > 0 &&
    accepted > 0 &&
    accepted + rejected === total &&
    unique > 0 &&
    unique <= accepted &&
    conflicts <= unique,
    "INVALID_AUDIT_COUNTERS"
  );

  required(
    preview.totalLines === total &&
    preview.accepted === accepted &&
    preview.rejected === rejected &&
    analysis.totalLines === total &&
    analysis.accepted === accepted &&
    analysis.rejected === rejected &&
    analysis.uniqueArticles === unique &&
    analysis.pricingConflicts === conflicts &&
    audit.duplicateAudit?.acceptedRows === accepted &&
    audit.duplicateAudit?.uniqueArticles === unique &&
    audit.duplicateAudit?.articlesWithDifferentTerms === conflicts,
    "AUDIT_COUNTERS_DO_NOT_MATCH"
  );

  const beforeMtime = info.mtimeMs;
  const calculatedSha = await fileHash(filename);
  const after = await lstat(filename);

  required(
    calculatedSha === sha &&
    after.size === info.size &&
    after.mtimeMs === beforeMtime,
    "SOURCE_FILE_CHANGED"
  );

  return {
    mode: "AUDITED_READY_FOR_ISOLATED_STAGE",
    fileId,
    filename,
    sha256: sha,
    fileSizeBytes: info.size,
    expectedLines: total,
    expectedAccepted: accepted,
    expectedUniqueArticles: unique,
    expectedPricingConflicts: conflicts,
    imported: false,
    activated: false,
  };
}
