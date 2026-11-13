#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstat,
  readFile,
  realpath,
  rename,
  unlink,
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

async function updateStatus(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(
      temp,
      JSON.stringify({
        ...data,
        updatedAt: new Date().toISOString(),
      }, null, 2),
      { flag: "wx", mode: 0o600 }
    );

    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

function runScript(script, fileId) {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "scripts", script), fileId],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 45 * 60 * 1000,
      maxBuffer: 3 * 1024 * 1024,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        NODE_ENV: "production",
        DOTENV_CONFIG_PATH: "/dev/null",
        MAKA_TXT_UPLOAD_MODE: "PRODUCTION_UPLOAD_ONLY",
        MAKA_TXT_UPLOAD_ROOT: TXT_UPLOAD_ROOT,
      },
    }
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      `${script} failed: ` +
      (
        result.error?.message ||
        result.stderr?.slice(-600) ||
        result.status
      )
    );
  }
}

async function main() {
  const fileId = process.argv[2];

  if (
    process.argv.length !== 3 ||
    !UUID.test(fileId || "")
  ) {
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
    throw new Error("Invalid isolated TXT source");
  }

  const metadata = JSON.parse(
    await readFile(`${filename}.json`, "utf8")
  );

  if (
    metadata.fileId !== fileId ||
    metadata.sourceKey !== "mercedes-txt" ||
    metadata.status !== "UPLOADED_UNVERIFIED" ||
    metadata.sizeBytes !== info.size ||
    !/^[0-9a-f]{64}$/.test(metadata.sha256 || "")
  ) {
    throw new Error("TXT upload metadata mismatch");
  }

  const statusFile = `${filename}.analysis.json`;

  // Exclusive creation prevents two analyses of the same upload.
  await writeFile(
    statusFile,
    JSON.stringify({
      fileId,
      sourceKey: "mercedes-txt",
      status: "QUEUED",
      imported: false,
      createdAt: new Date().toISOString(),
    }, null, 2),
    { flag: "wx", mode: 0o600 }
  );

  try {
    await updateStatus(statusFile, {
      fileId,
      sourceKey: "mercedes-txt",
      status: "PREVIEWING",
      imported: false,
    });

    console.error("STEP 1: PREVIEW");

    runScript(
      "preview-uploaded-mercedes-txt.mjs",
      fileId
    );

    const preview = JSON.parse(
      await readFile(
        `${filename}.preview.json`,
        "utf8"
      )
    );

    if (
      preview.status !== "PREVIEWED_NOT_IMPORTED" ||
      preview.fileId !== fileId ||
      preview.sha256 !== metadata.sha256
    ) {
      throw new Error("TXT preview verification failed");
    }

    await updateStatus(statusFile, {
      fileId,
      sourceKey: "mercedes-txt",
      status: "AUDITING",
      imported: false,
      totalLines: preview.totalLines,
      accepted: preview.accepted,
      rejected: preview.rejected,
    });

    console.error("STEP 2: DUPLICATE AUDIT");

    runScript(
      "audit-uploaded-mercedes-txt.mjs",
      fileId
    );

    const report = JSON.parse(
      await readFile(
        `${filename}.audit.json`,
        "utf8"
      )
    );

    if (
      report.status !== "AUDITED_NOT_IMPORTED" ||
      report.fileId !== fileId ||
      report.sha256 !== metadata.sha256 ||
      report.totalLines !== preview.totalLines ||
      report.accepted !== preview.accepted ||
      report.rejected !== preview.rejected ||
      !Number.isSafeInteger(report.uniqueArticles) ||
      !Number.isSafeInteger(report.pricingConflicts)
    ) {
      throw new Error("TXT duplicate audit verification failed");
    }

    const summary = {
      fileId,
      sourceKey: "mercedes-txt",
      status: "AUDITED_NOT_IMPORTED",
      imported: false,
      sha256: report.sha256,
      totalLines: report.totalLines,
      accepted: report.accepted,
      rejected: report.rejected,
      uniqueArticles: report.uniqueArticles,
      pricingConflicts: report.pricingConflicts,
      requiresExplicitActivation: true,
    };

    await updateStatus(statusFile, summary);

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await updateStatus(statusFile, {
      fileId,
      sourceKey: "mercedes-txt",
      status: "FAILED",
      imported: false,
      errorCode: "ANALYSIS_FAILED",
    });

    throw error;
  }
}

main().catch(error => {
  console.error("TXT ANALYSIS REFUSED:", error.message);
  process.exitCode = 1;
});
