#!/usr/bin/env node
/**
 * Read-only duplicate audit for MAKA special-order TXT.
 * Streams the source, writes a private temporary TSV and uses bounded-RAM
 * GNU sort. No database access or product-price changes.
 * Run with --file PATH --encoding windows-1251 --tmp-dir EXISTING_DIR
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, statfs } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { Transform } from "node:stream";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import readline from "node:readline";
import { parseSpecialOrderTxtLine } from "../src/services/SpecialOrderTxtParser.js";
import { createSpecialOrderDuplicateAudit } from "../src/services/SpecialOrderDuplicateAudit.js";

function arg(name, defaultValue = null) {
  const at = process.argv.indexOf(name);
  return at < 0 ? defaultValue : process.argv[at + 1] ?? null;
}

const filename = arg("--file");
const encoding = arg("--encoding", "windows-1251");
const tmpParent = arg("--tmp-dir", tmpdir());
const limitText = arg("--limit");

if (!filename || !encoding || !tmpParent ||
    (limitText !== null &&
      (!/^[1-9]\d*$/.test(limitText) || !Number.isSafeInteger(Number(limitText))))) {
  console.error("Usage: --file PATH [--encoding windows-1251|utf-8] [--tmp-dir EXISTING_DIR] [--limit N]");
  process.exitCode = 2;
} else {
  const source = resolve(filename);
  const { size } = await stat(source);
  const space = await statfs(tmpParent);
  const freeBytes = Number(space.bavail) * Number(space.bsize);
  if (freeBytes < 512 * 1024 * 1024) {
    throw new Error("Insufficient free temp disk space: " + freeBytes + " bytes (need 512 MiB)");
  }

  const scratch = await mkdtemp(join(resolve(tmpParent), "maka-duplicate-audit-"));
  const indexPath = join(scratch, "eligible-articles.tsv");
  const rejectionReasons = new Map();
  let lines = 0, accepted = 0, tools = 0, unexpectedWidths = 0;
  let bytesRead = 0;

  try {
    const decoder = new TextDecoder(encoding, { fatal: true });
    const sourceStream = createReadStream(source, { highWaterMark: 1024 * 1024 });
    const decoded = sourceStream.pipe(new Transform({
      transform(chunk, unused, done) {
        try {
          bytesRead += chunk.length;
          done(null, decoder.decode(chunk, { stream: true }));
        } catch (error) { done(error); }
      },
      final(done) {
        try { done(null, decoder.decode()); }
        catch (error) { done(error); }
      },
    }));
    const reader = readline.createInterface({ input: decoded, crlfDelay: Infinity });
    const output = createWriteStream(indexPath, { encoding: "utf8" });
    try {
      for await (const line of reader) {
        lines++;
        if (line.length !== 344) unexpectedWidths++;
        const parsed = parseSpecialOrderTxtLine(line);
        if (parsed.ok) {
          accepted++;
          if (parsed.record.isTool) tools++;
          const pieces = parsed.record.retailExVatUah.split(".");
          const price = pieces[0] + "." + (pieces[1] || "").padEnd(4, "0");
          const title = (parsed.record.title || "").replace(/[\t\r\n]/g, " ");
          const row = [
            parsed.record.articleNormalized, parsed.record.discountGroup,
            price, title, lines,
          ].join("\t") + "\n";
          if (!output.write(row)) await once(output, "drain");
        } else {
          rejectionReasons.set(parsed.reason, 1 + (rejectionReasons.get(parsed.reason) || 0));
        }
        if (lines % 200000 === 0) console.error("AUDIT LINES:", lines);
        if (limitText && lines >= Number(limitText)) {
          reader.close();
          break;
        }
      }
    } finally {
      sourceStream.destroy();
      output.end();
      await finished(output);
    }

    const collector = createSpecialOrderDuplicateAudit();
    const sorter = spawn("sort", [
      "--stable", "--buffer-size=64M", "--parallel=1",
      "--temporary-directory", scratch,
      "--field-separator=\t", "--key=1,1", indexPath,
    ], { env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    sorter.stderr.setEncoding("utf8");
    sorter.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4000); });
    const sortComplete = new Promise((ok, fail) => {
      sorter.on("error", fail);
      sorter.on("close", code => code === 0
        ? ok()
        : fail(new Error("sort exited " + code + ": " + stderr)));
    });

    const sorted = readline.createInterface({ input: sorter.stdout, crlfDelay: Infinity });
    for await (const line of sorted) {
      const columns = line.split("\t");
      if (columns.length !== 5) throw new Error("Invalid temporary index record");
      const [article, group, price, title, lineStr] = columns;
      collector.consume({ article, group, price, title, lineNumber: Number(lineStr) });
    }
    await sortComplete;
    const summary = collector.finish();
    if (summary.acceptedRows !== accepted) {
      throw new Error("Sorted row count differs from accepted row count");
    }

    console.log(JSON.stringify({
      mode: "READ_ONLY_SOURCE_NO_DATABASE_WRITES",
      sourceSizeBytes: size,
      sourceBytesRead: bytesRead,
      sourceLines: lines,
      accepted,
      rejected: lines - accepted,
      toolArticlesStartingW: tools,
      unexpectedRecordWidths: unexpectedWidths,
      rejectionReasons: Object.fromEntries(rejectionReasons),
      duplicateAudit: summary,
      note: "No winning price has been selected. Temporary files removed after audit.",
    }, null, 2));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
