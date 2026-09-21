import test from "node:test";
import assert from "node:assert/strict";

import { backfillMerchantImages } from "./MerchantImageBackfillService.js";

function imageRow(overrides = {}) {
  return {
    id: 595,
    product_id: 6537,
    article: "A4653201502",
    original_url: "https://images.example.test/originals/source.png",
    original_storage_key: "products/6537/originals/source.png",
    merchant_url_1500: null,
    merchant_storage_key_1500: null,
    ...overrides,
  };
}

function candidateLoader(rows) {
  return async () => ({ totalCandidates: rows.length, rows });
}

function storageMock(overrides = {}) {
  return {
    read: async () => Buffer.from("original"),
    uploadWebp: async () => {},
    remove: async () => {},
    publicUrl: (key) => `https://images.example.test/${key}`,
    ...overrides,
  };
}

test("creates a clean Merchant object and updates only Merchant database fields", async () => {
  const uploads = [];
  const queries = [];
  const db = {
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      return { rows: [{ id: parameters[0] }] };
    },
  };
  const summary = await backfillMerchantImages({ limit: 1 }, {
    db,
    loadCandidates: candidateLoader([imageRow()]),
    storage: storageMock({
      uploadWebp: async (key, body) => uploads.push({ key, body }),
    }),
    processMerchant: async () => ({ variant: Buffer.from("clean-merchant") }),
  });

  assert.equal(summary.processed, 1);
  assert.equal(summary.failed, 0);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].key, /^products\/6537\/merchant\/a4653201502-photo-595-.*-clean-1500\.webp$/);
  assert.equal(uploads[0].body.toString(), "clean-merchant");
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /SET merchant_url_1500=\$2,merchant_storage_key_1500=\$3/);
  assert.doesNotMatch(queries[0].sql, /processed_url|display_mode|image_branding_mode|original_url=/);
  assert.equal(queries[0].parameters[1], `https://images.example.test/${uploads[0].key}`);
  assert.equal(queries[0].parameters[2], uploads[0].key);
});

test("skips an image that already has both Merchant fields", async () => {
  let storageCalls = 0;
  const summary = await backfillMerchantImages({}, {
    db: { query: async () => { throw new Error("database update must not run"); } },
    loadCandidates: candidateLoader([imageRow({
      merchant_url_1500: "https://images.example.test/merchant/existing.webp",
      merchant_storage_key_1500: "products/6537/merchant/existing.webp",
    })]),
    storage: storageMock({ read: async () => { storageCalls += 1; } }),
  });

  assert.equal(summary.processed, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.reasons.already_has_merchant, 1);
  assert.equal(storageCalls, 0);
});

test("skips an image without an original storage key", async () => {
  const summary = await backfillMerchantImages({}, {
    db: { query: async () => { throw new Error("database update must not run"); } },
    loadCandidates: candidateLoader([imageRow({ original_storage_key: null })]),
    storage: storageMock({ read: async () => { throw new Error("R2 must not run"); } }),
  });

  assert.equal(summary.eligible, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.reasons.missing_original, 1);
});

test("continues the batch when processing one image fails", async () => {
  const uploads = [];
  const db = { query: async (_sql, parameters) => ({ rows: [{ id: parameters[0] }] }) };
  const summary = await backfillMerchantImages({}, {
    db,
    loadCandidates: candidateLoader([
      imageRow({ id: 595, original_storage_key: "bad-original" }),
      imageRow({ id: 596, original_storage_key: "good-original" }),
    ]),
    storage: storageMock({
      read: async (key) => Buffer.from(key),
      uploadWebp: async (key) => uploads.push(key),
    }),
    processMerchant: async (input) => {
      if (input.toString() === "bad-original") throw new Error("invalid image");
      return { variant: Buffer.from("clean") };
    },
  });

  assert.equal(summary.scanned, 2);
  assert.equal(summary.processed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.reasons.processing_error, 1);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0], /photo-596-/);
});

test("dry run reads candidates but never reads R2, uploads or writes to the database", async () => {
  const queries = [];
  const db = {
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: 1 }] };
      if (/SELECT pi\.id/.test(sql)) return { rows: [imageRow()] };
      throw new Error("dry run must not update the database");
    },
  };
  const summary = await backfillMerchantImages({ dryRun: true, limit: 25, cursor: 100 }, {
    db,
    storage: storageMock({
      read: async () => { throw new Error("dry run must not read R2"); },
      uploadWebp: async () => { throw new Error("dry run must not upload"); },
    }),
    processMerchant: async () => { throw new Error("dry run must not process"); },
  });

  assert.equal(queries.length, 2);
  assert.ok(queries.every(({ sql }) => /merchant_url_1500 IS NULL OR/.test(sql)));
  assert.deepEqual(queries.find(({ sql }) => /SELECT pi\.id/.test(sql)).parameters, [100, 25]);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.totalCandidates, 1);
  assert.equal(summary.scanned, 1);
  assert.equal(summary.eligible, 1);
  assert.equal(summary.processed, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.details[0].status, "would_process");
});
