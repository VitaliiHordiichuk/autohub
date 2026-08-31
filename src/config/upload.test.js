import assert from "node:assert/strict";
import test from "node:test";

import { normalizeUploadedFileName } from "./upload.js";

test("restores a UTF-8 Cyrillic upload filename decoded as latin1", () => {
  const expected = "PA Харків Mercedes (от ФОП) 28.08.2026.xlsx";
  const mojibake = Buffer.from(expected, "utf8").toString("latin1");

  assert.equal(normalizeUploadedFileName(mojibake), expected);
});

test("keeps a regular latin filename unchanged", () => {
  const fileName = "Mercedes 28.08.2026.xlsx";
  assert.equal(normalizeUploadedFileName(fileName), fileName);
});
