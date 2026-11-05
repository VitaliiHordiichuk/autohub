import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  makeSpecialOrderInsertBatch, stageSpecialOrderTxt,
} from "../src/services/SpecialOrderStageImportService.js";

function row(article, price, group = "20") {
  const a = Array(344).fill(" ");
  for (const [at, value] of [[21, article], [42, "TEST ITEM"], [106, group], [196, price]]) {
    for (let i = 0; i < value.length; i++) a[at + i] = value[i];
  }
  return a.join("");
}

function database({ delayRunMs = 0 } = {}) {
  const statements = [];
  const records = [];
  let status = null;
  const client = {
    async query(q, params = []) {
      const sql = typeof q === "string" ? q : q.text;
      const values = typeof q === "string" ? params : q.values;
      statements.push(sql);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (sql.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] };
      if (sql.includes("INSERT INTO special_order_import_runs")) {
        if (delayRunMs) await new Promise(resolve => setTimeout(resolve, delayRunMs));
        status = "IMPORTING";
        return { rows: [{ id: "42" }] };
      }
      if (sql.includes("INSERT INTO special_order_entries")) {
        for (let i = 0; i < values[1].length; i++) {
          records.push({
            line: values[1][i],
            article: values[3][i],
            group: values[5][i],
            price: values[6][i],
            title: values[4][i],
          });
        }
        return { rowCount: values[1].length };
      }
      if (sql.includes("COUNT(DISTINCT article_normalized)")) {
        return { rows: [{
          rows: String(records.length),
          unique_articles: String(new Set(records.map(r => r.article)).size),
        }] };
      }
      if (sql.includes("AS conflicts")) {
        const groups = new Map();
        for (const r of records) {
          if (!groups.has(r.article)) groups.set(r.article, new Set());
          groups.get(r.article).add(JSON.stringify([r.group, r.price, r.title || ""]));
        }
        return { rows: [{
          conflicts: String([...groups.values()].filter(x => x.size > 1).length),
        }] };
      }
      if (sql.includes("UPDATE special_order_import_runs")) {
        status = sql.includes("status = 'READY'") ? "READY" : "FAILED";
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, records, statements, get status() { return status; } };
}

async function withFile(text, fn) {
  const dir = await mkdtemp(join(tmpdir(), "special-order-stage-unit-"));
  const filename = join(dir, "source.txt");
  try {
    await writeFile(filename, text);
    return await fn(filename, createHash("sha256").update(text).digest("hex"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("stage importer never misses initial TXT rows during slow DB setup and NEVER activates", async () => {
  const text = [
    row("A0000011111", "1000,00"),
    row("A0000011111", "2000,00"),
    row("A0000022222", "3000,00"),
    row("A0000033333", "4000,00", "drt116"),
  ].join("\r\n") + "\r\n";
  await withFile(text, async (filename, sha) => {
    const db = database({ delayRunMs: 100 });
    const result = await stageSpecialOrderTxt({
      client: db.client, filename,
      expectedSha256: sha,
      expectedLines: 4, expectedAccepted: 3, expectedUniqueArticles: 2,
      expectedPricingConflicts: 1,
      batchSize: 2,
    });
    assert.equal(result.mode, "STAGED_NOT_ACTIVATED");
    assert.equal(result.accepted, 3);
    assert.equal(result.rejected, 1);
    assert.equal(result.uniqueArticles, 2);
    assert.equal(result.pricingConflicts, 1);
    assert.equal(result.rejectionReasons.DISCOUNT_GROUP_EXCLUDED, 1);
    assert.deepEqual(db.records.map(x => x.line), [1, 2, 3]);
    assert.equal(db.status, "READY");
    assert.ok(db.statements.some(x => x.includes("INSERT INTO special_order_entries")));
    assert.ok(!db.statements.some(x => /(?:INSERT|UPDATE)\s+special_order_sources/i.test(x)));
  });
});

test("stage importer marks FAILED if source digest is not the approved one", async () => {
  const text = row("A0000011111", "1000,00") + "\n";
  await withFile(text, async filename => {
    const db = database();
    await assert.rejects(() => stageSpecialOrderTxt({
      client: db.client, filename,
      expectedSha256: "0".repeat(64),
      expectedLines: 1, expectedAccepted: 1, expectedUniqueArticles: 1,
      expectedPricingConflicts: 0,
    }), /SHA-256 mismatch/);
    assert.equal(db.status, "FAILED");
    assert.ok(!db.statements.some(x => /(?:INSERT|UPDATE)\s+special_order_sources/i.test(x)));
  });
});

test("stage importer never promotes when expected conflict count disagrees", async () => {
  const text = row("A0000011111", "1000,00") + "\n";
  await withFile(text, async (filename, sha) => {
    const db = database();
    await assert.rejects(() => stageSpecialOrderTxt({
      client: db.client, filename, expectedSha256: sha,
      expectedLines: 1, expectedAccepted: 1, expectedUniqueArticles: 1,
      expectedPricingConflicts: 1,
    }), /Conflict count differs/);
    assert.equal(db.status, "FAILED");
  });
});

test("stage importer refuses a wrong distinct-article count", async () => {
  const text = row("A0000011111", "1000,00") + "\n";
  await withFile(text, async (filename, sha) => {
    const db = database();
    await assert.rejects(() => stageSpecialOrderTxt({
      client: db.client, filename, expectedSha256: sha,
      expectedLines: 1, expectedAccepted: 1, expectedUniqueArticles: 2,
      expectedPricingConflicts: 0,
    }), /unique-article counts/);
    assert.equal(db.status, "FAILED");
  });
});

test("batch limits protect SQL parameter allocation", () => {
  assert.throws(() => makeSpecialOrderInsertBatch(1, []), /batch length/);
  assert.throws(() => makeSpecialOrderInsertBatch(1, Array(1001).fill({})), /batch length/);
});
