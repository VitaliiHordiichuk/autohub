import multer from "multer";

import {
  TXT_PRODUCTION_UPLOAD_ROOT,
  assertProductionTxtUpload,
} from "./SpecialOrderTxtProductionStorageGuard.js";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname } from "node:path";

export const TXT_UPLOAD_ROOT = TXT_PRODUCTION_UPLOAD_ROOT;

export const TXT_UPLOAD_MAX_BYTES =
  768 * 1024 * 1024;

export function validTxtUploadName(name) {
  return (
    typeof name === "string" &&
    name.length > 4 &&
    name.length <= 180 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    /\.txt$/i.test(name)
  );
}

export async function assertTxtUploadStage(
  env = process.env
) {
  return assertProductionTxtUpload(env);
}

const storage = multer.diskStorage({
  destination(req, file, callback) {
    assertTxtUploadStage().then(
      path => callback(null, path),
      error => callback(error)
    );
  },

  filename(req, file, callback) {
    callback(null, `${randomUUID()}.txt`);
  },
});

export const receiveTxtFile = multer({
  storage,
  limits: {
    fileSize: TXT_UPLOAD_MAX_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter(req, file, callback) {
    if (!validTxtUploadName(file.originalname)) {
      return callback(new Error("INVALID_TXT_FILENAME"));
    }

    callback(null, true);
  },
}).single("file");

export async function describeStagedTxtFile(file) {
  await assertTxtUploadStage();

  if (!file || !file.path) {
    throw new Error("TXT file missing");
  }

  const actual = await realpath(file.path);

  if (
    dirname(actual) !== TXT_UPLOAD_ROOT ||
    !/^[0-9a-f-]{36}\.txt$/.test(basename(actual))
  ) {
    throw new Error("Untrusted TXT file path");
  }

  const info = await stat(actual);

  if (
    !info.isFile() ||
    info.size < 100 ||
    info.size > TXT_UPLOAD_MAX_BYTES
  ) {
    throw new Error("Invalid TXT file size");
  }

  const hash = createHash("sha256");

  for await (const chunk of createReadStream(actual)) {
    hash.update(chunk);
  }

  const summary = {
    fileId: basename(actual, ".txt"),
    originalName: file.originalname,
    sizeBytes: info.size,
    sha256: hash.digest("hex"),
    sourceKey: "mercedes-txt",
    status: "UPLOADED_UNVERIFIED",
    createdAt: new Date().toISOString(),
  };

  await writeFile(
    `${actual}.json`,
    JSON.stringify(summary, null, 2),
    {
      flag: "wx",
      mode: 0o600,
    }
  );

  return summary;
}
