/**
 * Stage a full, immutable special-order TXT revision in a dedicated test DB.
 * Never activates the revision or creates catalog products/offers.
 * Import runs are non-active while IMPORTING/FAILED; READY is not published.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import readline from "node:readline";
import { parseSpecialOrderTxtLine } from "./SpecialOrderTxtParser.js";

const INSERT = `
INSERT INTO special_order_entries (
  import_id, line_number, article, article_normalized,
  title, discount_group, retail_ex_vat_uah
)
SELECT $1::bigint, r.line_number, r.article, r.article_normalized,
       r.title, r.discount_group, r.retail_ex_vat_uah
FROM unnest(
  $2::bigint[], $3::varchar[], $4::varchar[],
  $5::text[], $6::varchar[], $7::numeric[]
) AS r(line_number, article, article_normalized,
       title, discount_group, retail_ex_vat_uah)
`;

export function makeSpecialOrderInsertBatch(importId, rows) {
  if (!Number.isSafeInteger(Number(importId)) || !rows.length || rows.length > 1000) {
    throw new RangeError("Invalid import ID or batch length (1-1000)");
  }
  return {
    text: INSERT,
    values: [
      importId,
      rows.map(x => x.lineNumber),
      rows.map(x => x.article),
      rows.map(x => x.articleNormalized),
      rows.map(x => x.title),
      rows.map(x => x.discountGroup),
      rows.map(x => x.retailExVatUah),
    ],
  };
}

export async function stageSpecialOrderTxt({
  client, filename, encoding = "windows-1251",
  expectedSha256, expectedLines, expectedAccepted,
  expectedPricingConflicts, batchSize = 750,
  onProgress = () => {},
}) {
  if (!client || typeof client.query !== "function") throw new TypeError("client required");
  if (!filename || !/^[0-9a-f]{64}$/.test(expectedSha256 || "")) {
    throw new Error("Filename and exact SHA-256 are mandatory");
  }
  for (const number of [expectedLines, expectedAccepted, expectedPricingConflicts]) {
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new Error("Expected counts must be safe non-negative integers");
    }
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new RangeError("batchSize must be in 1-1000");
  }
  const fileStat = await stat(filename);
  if (!fileStat.isFile() || fileStat.size < 100) throw new Error("Invalid input file");

  // Validate the decoder before taking the session advisory lock.
  const decoder = new TextDecoder(encoding, { fatal: true });

  const lock = await client.query(
    "SELECT pg_try_advisory_lock(204839812, 125) AS locked"
  );
  if (lock.rows[0]?.locked !== true) throw new Error("Another special-order stage import holds the lock");

  let importId = null;
  let lineNumber = 0, accepted = 0;
  const rejectedReasons = {};
  const pending = [];
  const digest = createHash("sha256");
  const input = createReadStream(filename, { highWaterMark: 1024 * 1024 });
  const decoded = input.pipe(new Transform({
    transform(chunk, unused, callback) {
      try {
        digest.update(chunk);
        callback(null, decoder.decode(chunk, { stream: true }));
      } catch (error) {
        callback(error);
      }
    },
    final(callback) {
      try { callback(null, decoder.decode()); }
      catch (error) { callback(error); }
    },
  }));
  const reader = readline.createInterface({ input: decoded, crlfDelay: Infinity });

  async function flush() {
    if (!pending.length) return;
    const args = makeSpecialOrderInsertBatch(importId, pending);
    const result = await client.query(args);
    if (result.rowCount !== pending.length) {
      throw new Error("Bulk batch row count mismatch");
    }
    pending.length = 0;
  }

  try {
    await client.query("BEGIN");
    const run = await client.query(
      `INSERT INTO special_order_import_runs (source_key, status)
       VALUES ('mercedes-txt', 'IMPORTING')
       RETURNING id`
    );
    importId = Number(run.rows[0]?.id);
    if (!Number.isSafeInteger(importId)) throw new Error("Invalid run ID");
    await client.query("COMMIT");

    for await (const line of reader) {
      lineNumber++;
      if (lineNumber > expectedLines) throw new Error("More source rows than expected");
      const parsed = parseSpecialOrderTxtLine(line);
      if (parsed.ok) {
        accepted++;
        pending.push({ ...parsed.record, lineNumber });
        if (pending.length >= batchSize) await flush();
      } else {
        rejectedReasons[parsed.reason] = 1 + (rejectedReasons[parsed.reason] || 0);
      }
      if (lineNumber % 200000 === 0) onProgress({ lines: lineNumber, accepted });
    }
    await flush();

    if (lineNumber !== expectedLines || accepted !== expectedAccepted) {
      throw new Error("Input counters differ from approved dry-run");
    }
    const actualSha256 = digest.digest("hex");
    if (actualSha256 !== expectedSha256) {
      throw new Error("Source SHA-256 mismatch, revision must not be published");
    }
    const stored = await client.query(
      `SELECT COUNT(*)::bigint AS rows,
              COUNT(DISTINCT article_normalized)::bigint AS unique_articles
       FROM special_order_entries WHERE import_id = $1`,
      [importId]
    );
    const rowsStored = Number(stored.rows[0]?.rows);
    const uniqueArticles = Number(stored.rows[0]?.unique_articles);
    if (rowsStored !== accepted || !Number.isSafeInteger(uniqueArticles)) {
      throw new Error("Database counts do not match the source");
    }
    const conflictsResult = await client.query(
      `SELECT COUNT(*)::bigint AS conflicts FROM (
        SELECT article_normalized
        FROM special_order_entries
        WHERE import_id = $1
        GROUP BY article_normalized
        HAVING COUNT(DISTINCT (
          discount_group, retail_ex_vat_uah, COALESCE(BTRIM(title), '')
        )) > 1
       ) AS ambiguous`,
      [importId]
    );
    const pricingConflicts = Number(conflictsResult.rows[0]?.conflicts);
    if (pricingConflicts !== expectedPricingConflicts) {
      throw new Error("Conflict count differs from approved audit");
    }

    await client.query("BEGIN");
    const readyResult = await client.query(
      `UPDATE special_order_import_runs
       SET status = 'READY', total_lines = $2, eligible_lines = $3,
           rejected_lines = $4, finished_at = NOW()
       WHERE id = $1 AND status = 'IMPORTING'`,
      [importId, lineNumber, accepted, lineNumber - accepted]
    );
    if (readyResult.rowCount !== 1) throw new Error("Run status transition failed");
    // Intentionally DO NOT touch special_order_sources.active_import_id.
    await client.query("COMMIT");

    return {
      mode: "STAGED_NOT_ACTIVATED",
      importId, sourceSha256: actualSha256,
      totalLines: lineNumber, accepted, rejected: lineNumber - accepted,
      uniqueArticles, pricingConflicts, rejectionReasons: rejectedReasons,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    if (importId !== null) {
      try {
        await client.query(
          `UPDATE special_order_import_runs
           SET status = 'FAILED', total_lines = $2, eligible_lines = $3,
               rejected_lines = $4, finished_at = NOW()
           WHERE id = $1 AND status = 'IMPORTING'`,
          [importId, lineNumber, accepted, lineNumber - accepted]
        );
      } catch { /* the active revision has never been changed */ }
    }
    throw error;
  } finally {
    reader.close();
    input.destroy();
    try {
      await client.query("SELECT pg_advisory_unlock(204839812, 125)");
    } catch { /* release on client disconnect */ }
  }
}
