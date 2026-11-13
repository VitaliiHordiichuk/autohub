#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  assertTxtUploadStage,
  TXT_UPLOAD_ROOT,
  TXT_UPLOAD_MAX_BYTES,
} from "../src/services/SpecialOrderTxtBrowserUploadService.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sha256File(filename) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function main() {
  const fileId = process.argv[2];

  if (process.argv.length !== 3 || !UUID.test(fileId || "")) {
    throw new Error("Invalid uploaded TXT file ID");
  }

  await assertTxtUploadStage();

  const filename = join(TXT_UPLOAD_ROOT, `${fileId}.txt`);
  const actual = await realpath(filename);
  const info = await lstat(filename);

  if (
    dirname(actual) !== TXT_UPLOAD_ROOT ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 100 ||
    info.size > TXT_UPLOAD_MAX_BYTES
  ) {
    throw new Error("Unsafe or invalid TXT source");
  }

  const metadata = JSON.parse(
    await readFile(`${filename}.json`, "utf8")
  );

  const preview = JSON.parse(
    await readFile(`${filename}.preview.json`, "utf8")
  );

  if (
    metadata.fileId !== fileId ||
    metadata.sourceKey !== "mercedes-txt" ||
    metadata.status !== "UPLOADED_UNVERIFIED" ||
    metadata.sizeBytes !== info.size ||
    preview.fileId !== fileId ||
    preview.status !== "PREVIEWED_NOT_IMPORTED" ||
    preview.sourceKey !== "mercedes-txt" ||
    preview.fileSizeBytes !== info.size ||
    preview.sha256 !== metadata.sha256 ||
    preview.encoding !== "windows-1251" ||
    !/^[0-9a-f]{64}$/.test(metadata.sha256 || "")
  ) {
    throw new Error("TXT metadata or preview mismatch");
  }

  const originalHash = await sha256File(filename);

  if (originalHash !== metadata.sha256) {
    throw new Error("TXT SHA-256 mismatch before audit");
  }

  const scanner = join(
    process.cwd(),
    "scripts/audit-special-order-duplicates.mjs"
  );

  console.error("AUDITING TXT:", fileId);
  console.error("SOURCE SIZE:", info.size);

  // This is a separate CLI worker, never called synchronously
  // from the live HTTP request handler.
  const result = spawnSync(
    process.execPath,
    [
      scanner,
      "--file", filename,
      "--encoding", "windows-1251",
      "--tmp-dir", TXT_UPLOAD_ROOT,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        NODE_ENV: "production",
        DOTENV_CONFIG_PATH: "/dev/null",
      },
    }
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      "TXT duplicate audit failed: " +
      (result.error?.message ||
        result.stderr?.slice(-3000) ||
        result.status)
    );
  }

  const audit = JSON.parse(result.stdout);
  const d = audit.duplicateAudit;

  if (
    audit.mode !== "READ_ONLY_SOURCE_NO_DATABASE_WRITES" ||
    audit.sourceSizeBytes !== info.size ||
    audit.sourceBytesRead !== info.size ||
    audit.sourceLines !== preview.totalLines ||
    audit.accepted !== preview.accepted ||
    audit.rejected !== preview.rejected ||
    !d ||
    d.acceptedRows !== audit.accepted ||
    !Number.isSafeInteger(d.uniqueArticles) ||
    d.uniqueArticles < 1 ||
    d.uniqueArticles > audit.accepted ||
    !Number.isSafeInteger(d.articlesWithDifferentTerms) ||
    d.articlesWithDifferentTerms < 0 ||
    d.articlesWithDifferentTerms > d.uniqueArticles
  ) {
    throw new Error("TXT audit and preview counters differ");
  }

  const finalHash = await sha256File(filename);
  const finalInfo = await lstat(filename);

  if (
    finalHash !== originalHash ||
    finalInfo.size !== info.size ||
    finalInfo.mtimeMs !== info.mtimeMs
  ) {
    throw new Error("TXT source changed during audit");
  }

  const report = {
    fileId,
    sourceKey: "mercedes-txt",
    status: "AUDITED_NOT_IMPORTED",
    sha256: finalHash,
    encoding: "windows-1251",
    fileSizeBytes: info.size,
    totalLines: audit.sourceLines,
    accepted: audit.accepted,
    rejected: audit.rejected,
    uniqueArticles: d.uniqueArticles,

    // Matches the importer's SQL DISTINCT(group, price, title).
    pricingConflicts: d.articlesWithDifferentTerms,

    priceOrGroupConflicts:
      d.articlesWithDifferentPriceOrGroup,

    unexpectedRecordWidths: audit.unexpectedRecordWidths,
    rejectionReasons: audit.rejectionReasons,
    duplicateAudit: d,
    requiresExplicitActivation: true,
    imported: false,
    createdAt: new Date().toISOString(),
  };

  await writeFile(
    `${filename}.audit.json`,
    JSON.stringify(report, null, 2),
    { flag: "wx", mode: 0o600 }
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error("AUDIT REFUSED:", error.message);
  process.exitCode = 1;
});
