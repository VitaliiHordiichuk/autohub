import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashTxtSourceFileAt } from "./SpecialOrderTxtSourceIntegrityService.js";

const id = "883092b1-e6c1-46cb-b5b3-476f4969ebe6";

test("hashes the actual bytes, not the recorded metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maka-source-hash-"));
  try {
    const filepath = join(dir, `${id}.txt`);
    const first = Buffer.alloc(1024, 65);
    const second = Buffer.alloc(1024, 66);
    await writeFile(filepath, first, { mode: 0o600 });
    assert.equal(await hashTxtSourceFileAt(dir, id), createHash("sha256").update(first).digest("hex"));
    await writeFile(filepath, second);
    assert.equal(await hashTxtSourceFileAt(dir, id), createHash("sha256").update(second).digest("hex"));
    assert.notEqual(createHash("sha256").update(first).digest("hex"), createHash("sha256").update(second).digest("hex"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rejects invalid file identifiers, missing source and symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maka-source-guard-"));
  try {
    await assert.rejects(hashTxtSourceFileAt(dir, "../not-valid"));
    await assert.rejects(hashTxtSourceFileAt(dir, id));
    const destination = join(dir, "actual.txt");
    await writeFile(destination, Buffer.alloc(1024, 65));
    await symlink(destination, join(dir, `${id}.txt`));
    await assert.rejects(hashTxtSourceFileAt(dir, id));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
