#!/usr/bin/env node
/**
 * Read-only preview of a large fixed-width TXT special-order price file.
 * Streams lines; DOES NOT touch PostgreSQL, the website or other files.
 *
 * Usage:
 * node scripts/preview-special-order-txt.mjs --file "/path/to/prices.txt"
 * node scripts/preview-special-order-txt.mjs --file "/path/to/prices.txt" --encoding windows-1251
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Transform } from "node:stream";
import readline from "node:readline";
import { parseSpecialOrderTxtLine } from "../src/services/SpecialOrderTxtParser.js";

function flag(name, defaultValue = null) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] ?? null : defaultValue;
}

const file = flag("--file");
const encoding = flag("--encoding", "utf-8");
const maxLinesRaw = flag("--limit");

if (!file || !encoding || (maxLinesRaw &&
  (!/^[1-9][0-9]*$/.test(maxLinesRaw) ||
   !Number.isSafeInteger(Number(maxLinesRaw))))) {
  console.error("Usage: --file PATH [--encoding utf-8|windows-1251] [--limit N]");
  process.exitCode = 2;
} else {
  const size = (await stat(file)).size;
  const decoder = new TextDecoder(encoding, { fatal: true });
  let bytesRead = 0;
  const decoded = createReadStream(file, { highWaterMark: 1024 * 1024 })
    .pipe(new Transform({
      transform(chunk, unused, done) {
        try {
          bytesRead += chunk.length;
          done(null, decoder.decode(chunk, { stream: true }));
        } catch (error) {
          done(error);
        }
      },
      final(done) {
        try { done(null, decoder.decode()); }
        catch (error) { done(error); }
      },
    }));

  const lines = readline.createInterface({input: decoded, crlfDelay: Infinity});
  const reasons = new Map();
  let count = 0, accepted = 0, tools = 0;
  const examples = [];
  try {
    for await (const line of lines) {
      count += 1;
      const parsed = parseSpecialOrderTxtLine(line);
      if (parsed.ok) {
        accepted += 1;
        if (parsed.record.isTool) tools += 1;
        if (examples.length < 5) examples.push({
          article:parsed.record.article,
          group:parsed.record.discountGroup,
          retailExVatUah:parsed.record.retailExVatUah,
        });
      } else {
        reasons.set(parsed.reason, (reasons.get(parsed.reason) || 0) + 1);
      }
      if (count % 200000 === 0) console.error("LINES SCANNED:", count);
      if (maxLinesRaw && count >= Number(maxLinesRaw)) {
        lines.close();
        break;
      }
    }
  } finally {
    decoded.destroy();
  }

  console.log(JSON.stringify({
    mode:"DRY_RUN_NO_DATABASE_WRITES",
    fileSizeBytes:size, bytesRead, lines:count,
    accepted, rejected:count - accepted,
    toolArticlesStartingW:tools,
    rejectionReasons:Object.fromEntries(reasons),
    examples,
  }, null, 2));
}
