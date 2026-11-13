import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import {
  assertProductionTxtUpload,
  TXT_PRODUCTION_UPLOAD_ROOT,
} from "./SpecialOrderTxtProductionStorageGuard.js";

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const MAX_BYTES = 768 * 1024 * 1024;
const FAIL = "TXT_RECONCILIATION_REQUIRED";

// Purely local read. Used by isolated tests; production caller MUST validate root.
export async function hashTxtSourceFileAt(root, fileId) {
  if (!FILE_ID.test(fileId) || typeof constants.O_NOFOLLOW !== "number") {
    throw new Error(FAIL);
  }
  const file = await open(
    join(root, `${fileId}.txt`),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.uid !== BigInt(process.getuid()) ||
      before.size < 100n ||
      before.size > BigInt(MAX_BYTES) ||
      (before.mode & 0o022n) !== 0n
    ) throw new Error(FAIL);

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      if (position > MAX_BYTES) throw new Error(FAIL);
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat({ bigint: true });
    if (
      BigInt(position) !== before.size ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) throw new Error(FAIL);
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}

export async function assertProductionTxtSourceIntegrity(fileId, expectedSha256) {
  if (typeof expectedSha256 !== "string" || !SHA.test(expectedSha256)) {
    throw new Error(FAIL);
  }
  try {
    await assertProductionTxtUpload();
    const actualSha = await hashTxtSourceFileAt(TXT_PRODUCTION_UPLOAD_ROOT, fileId);
    if (actualSha !== expectedSha256) throw new Error(FAIL);
    return true;
  } catch {
    // Never expose production paths or filesystem errors to external callers.
    throw new Error(FAIL);
  }
}
