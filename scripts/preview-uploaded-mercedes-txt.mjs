#!/usr/bin/env node

import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  assertTxtUploadStage,
  TXT_UPLOAD_ROOT,
  TXT_UPLOAD_MAX_BYTES,
} from "../src/services/SpecialOrderTxtBrowserUploadService.js";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main() {
  const fileId = process.argv[2];

  if (
    process.argv.length !== 3 ||
    !UUID_V4.test(fileId || "")
  ) {
    throw new Error("Valid uploaded TXT file ID required");
  }

  await assertTxtUploadStage();

  const filename = join(TXT_UPLOAD_ROOT, `${fileId}.txt`);
  const metadataFile = `${filename}.json`;
  const reportFile = `${filename}.preview.json`;

  const actual = await realpath(filename);
  const info = await lstat(filename);

  if (
    dirname(actual) !== TXT_UPLOAD_ROOT ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 100 ||
    info.size > TXT_UPLOAD_MAX_BYTES
  ) {
    throw new Error("Unsafe or invalid uploaded TXT file");
  }

  const metadata = JSON.parse(
    await readFile(metadataFile, "utf8")
  );

  if (
    metadata.fileId !== fileId ||
    metadata.status !== "UPLOADED_UNVERIFIED" ||
    metadata.sourceKey !== "mercedes-txt" ||
    metadata.sizeBytes !== info.size ||
    !/^[0-9a-f]{64}$/.test(metadata.sha256 || "")
  ) {
    throw new Error("Uploaded TXT metadata mismatch");
  }

  const digest = createHash("sha256");

  for await (const chunk of createReadStream(filename)) {
    digest.update(chunk);
  }

  const sha256 = digest.digest("hex");

  if (sha256 !== metadata.sha256) {
    throw new Error("Uploaded TXT SHA-256 mismatch");
  }

  console.error("FILE ID:", fileId);
  console.error("SIZE VERIFIED:", info.size);
  console.error("SHA-256 VERIFIED:", sha256);
  console.error("STARTING READ-ONLY TXT PREVIEW");

  const scanner = join(
    process.cwd(),
    "scripts/preview-special-order-txt.mjs"
  );

  const result = spawnSync(
    process.execPath,
    [
      scanner,
      "--file", filename,
      "--encoding", "windows-1251",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30 * 60 * 1000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "production",
        DOTENV_CONFIG_PATH: "/dev/null",
      },
    }
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      "TXT parser failed: " +
      (result.error?.message || result.stderr || result.status)
    );
  }

  const preview = JSON.parse(result.stdout);

  if (
    preview.mode !== "DRY_RUN_NO_DATABASE_WRITES" ||
    preview.fileSizeBytes !== info.size ||
    preview.bytesRead !== info.size ||
    !Number.isSafeInteger(preview.lines) ||
    !Number.isSafeInteger(preview.accepted) ||
    !Number.isSafeInteger(preview.rejected) ||
    preview.lines < 1 ||
    preview.accepted < 1 ||
    preview.accepted + preview.rejected !== preview.lines
  ) {
    throw new Error("TXT preview result failed validation");
  }

  const after = await stat(filename);

  if (
    after.size !== info.size ||
    after.mtimeMs !== info.mtimeMs
  ) {
    throw new Error("TXT file changed during preview");
  }

  const report = {
    fileId,
    sourceKey: "mercedes-txt",
    status: "PREVIEWED_NOT_IMPORTED",
    fileSizeBytes: info.size,
    sha256,
    encoding: "windows-1251",
    totalLines: preview.lines,
    accepted: preview.accepted,
    rejected: preview.rejected,
    rejectionReasons: preview.rejectionReasons,
    examples: preview.examples,
    uniqueArticles: null,
    pricingConflicts: null,
    requiresDuplicateAudit: true,
    requiresExplicitActivation: true,
    createdAt: new Date().toISOString(),
  };

  await writeFile(
    reportFile,
    JSON.stringify(report, null, 2),
    { flag: "wx", mode: 0o600 }
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error("PREVIEW REFUSED:", error.message);
  process.exitCode = 1;
});
