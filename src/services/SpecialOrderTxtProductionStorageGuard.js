import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";

import { join } from "node:path";

export const TXT_PRODUCTION_UPLOAD_ROOT =
  "/home/ubuntu/maka-mercedes-txt-prod-uploads-20261110";

const EXPECTED_MARKER =
  "MAKA_TXT_PRODUCTION_STORAGE_20261110";

/*
 * This authorizes only the upload storage.
 * It does not authorize database imports or activation.
 */
export async function assertProductionTxtUpload(
  env = process.env
) {
  if (
    env.NODE_ENV !== "production" ||
    env.MAKA_TXT_UPLOAD_MODE !== "PRODUCTION_UPLOAD_ONLY" ||
    env.MAKA_TXT_UPLOAD_ROOT !== TXT_PRODUCTION_UPLOAD_ROOT
  ) {
    throw new Error("TXT_PRODUCTION_UPLOAD_DISABLED");
  }

  const root = TXT_PRODUCTION_UPLOAD_ROOT;
  const marker = join(root, ".production-marker");

  const [actual, rootInfo, markerInfo] =
    await Promise.all([
      realpath(root),
      lstat(root),
      lstat(marker),
    ]);

  if (
    actual !== root ||
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    (rootInfo.mode & 0o777) !== 0o700 ||
    rootInfo.uid !== process.getuid()
  ) {
    throw new Error("INVALID_PRODUCTION_UPLOAD_ROOT");
  }

  if (
    !markerInfo.isFile() ||
    markerInfo.isSymbolicLink() ||
    (markerInfo.mode & 0o777) !== 0o600 ||
    markerInfo.uid !== process.getuid()
  ) {
    throw new Error("INVALID_PRODUCTION_UPLOAD_MARKER");
  }

  const value = await readFile(marker, "utf8");

  if (value.trim() !== EXPECTED_MARKER) {
    throw new Error("PRODUCTION_UPLOAD_MARKER_MISMATCH");
  }

  return actual;
}
