import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import {
  lstat,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertTxtUploadStage,
  TXT_UPLOAD_ROOT,
  TXT_UPLOAD_MAX_BYTES,
} from "./SpecialOrderTxtBrowserUploadService.js";

const BACK_ROOT = fileURLToPath(
  new URL("../../", import.meta.url)
);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validTxtAnalysisFileId(id) {
  return typeof id === "string" && UUID.test(id);
}

export class TxtAnalysisJobError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function sourcePath(fileId) {
  if (!validTxtAnalysisFileId(fileId)) {
    throw new TxtAnalysisJobError("INVALID_FILE_ID");
  }

  return join(TXT_UPLOAD_ROOT, `${fileId}.txt`);
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function getTxtAnalysisStatus(fileId) {
  await assertTxtUploadStage();

  const filename = sourcePath(fileId);

  const [analysis, launch] = await Promise.all([
    readJsonOrNull(`${filename}.analysis.json`),
    readJsonOrNull(`${filename}.launch.json`),
  ]);

  if (!analysis && !launch) return null;

  const source = analysis || launch;

  if (
    source.fileId !== fileId ||
    source.sourceKey !== "mercedes-txt"
  ) {
    throw new TxtAnalysisJobError("INVALID_JOB_STATE");
  }

  const allowedStatuses = new Set([
    "QUEUED",
    "PREVIEWING",
    "AUDITING",
    "AUDITED_NOT_IMPORTED",
    "FAILED",
  ]);

  if (!allowedStatuses.has(source.status)) {
    throw new TxtAnalysisJobError("INVALID_JOB_STATE");
  }

  const result = {
    fileId,
    sourceKey: "mercedes-txt",
    status: source.status,
    imported: false,
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };

  for (const key of [
    "totalLines",
    "accepted",
    "rejected",
    "uniqueArticles",
    "pricingConflicts",
  ]) {
    if (
      Number.isSafeInteger(source[key]) &&
      source[key] >= 0
    ) {
      result[key] = source[key];
    }
  }

  return result;
}

export async function startTxtAnalysis(fileId) {
  await assertTxtUploadStage();

  const filename = sourcePath(fileId);

  let actual;
  let info;

  try {
    [actual, info] = await Promise.all([
      realpath(filename),
      lstat(filename),
    ]);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new TxtAnalysisJobError("UPLOAD_NOT_FOUND");
    }
    throw error;
  }

  if (
    dirname(actual) !== TXT_UPLOAD_ROOT ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 100 ||
    info.size > TXT_UPLOAD_MAX_BYTES
  ) {
    throw new TxtAnalysisJobError("INVALID_UPLOAD");
  }

  const metadata = await readJsonOrNull(
    `${filename}.json`
  );

  if (
    !metadata ||
    metadata.fileId !== fileId ||
    metadata.sourceKey !== "mercedes-txt" ||
    metadata.status !== "UPLOADED_UNVERIFIED" ||
    metadata.sizeBytes !== info.size ||
    !/^[0-9a-f]{64}$/.test(metadata.sha256 || "")
  ) {
    throw new TxtAnalysisJobError("INVALID_UPLOAD");
  }

  const previous = await getTxtAnalysisStatus(fileId);

  if (previous) {
    throw new TxtAnalysisJobError("ALREADY_STARTED");
  }

  const launchPath = `${filename}.launch.json`;

  const queued = {
    fileId,
    sourceKey: "mercedes-txt",
    status: "QUEUED",
    imported: false,
    createdAt: new Date().toISOString(),
  };

  try {
    await writeFile(
      launchPath,
      JSON.stringify(queued, null, 2),
      { flag: "wx", mode: 0o600 }
    );
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new TxtAnalysisJobError("ALREADY_STARTED");
    }
    throw error;
  }

  const logPath = `${filename}.analysis.log`;
  let fd;

  try {
    fd = openSync(logPath, "wx", 0o600);

    const child = spawn(
      process.execPath,
      [
        join(
          BACK_ROOT,
          "scripts/analyze-uploaded-mercedes-txt.mjs"
        ),
        fileId,
      ],
      {
        cwd: BACK_ROOT,
        detached: true,
        stdio: ["ignore", fd, fd],
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

    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    child.unref();

  } catch (error) {
    await unlink(launchPath).catch(() => {});
    await unlink(logPath).catch(() => {});
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }

  return queued;
}
