import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

import { ProductImageService, processProductImageRecord } from "./ProductImageService.js";
import { processProductImage } from "./ProductImageProcessor.js";

const environmentNames = [
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "SMART_PRODUCT_IMAGES_ENABLED",
  "AUTH_JWT_SECRET",
];
const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, process.env[name]]),
);
const originalSend = S3Client.prototype.send;

function lifecycleQuery(sql) {
  if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }] };
  if (/SELECT processing_request_id/.test(sql)) return { rows: [{ processing_request_id: 0 }] };
  if (/product_image_objects|pg_advisory_unlock/.test(sql) || ['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
  return null;
}

before(() => {
  process.env.R2_ENDPOINT = "https://r2.example.test";
  process.env.R2_ACCESS_KEY_ID = "test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.R2_BUCKET = "test-products";
  process.env.R2_PUBLIC_BASE_URL = "https://images.example.test";
  process.env.AUTH_JWT_SECRET = "test-auth-secret-that-is-at-least-thirty-two-characters";
});

after(() => {
  S3Client.prototype.send = originalSend;
  for (const name of environmentNames) {
    if (originalEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnvironment[name];
  }
});

test("reprocesses the site branch and always writes a separate clean Merchant image", async () => {
  const productObject = await sharp({
    create: { width: 800, height: 280, channels: 3, background: "#a62035" },
  }).png().toBuffer();
  const original = await sharp({
    create: { width: 1400, height: 1000, channels: 3, background: "#ffffff" },
  }).composite([{ input: productObject, left: 300, top: 360 }]).png().toBuffer();

  const puts = [];
  const deletes = [];
  const objects = new Map();
  S3Client.prototype.send = async function send(command) {
    const checksumSetting = this.config.requestChecksumCalculation;
    assert.equal(typeof checksumSetting === 'function' ? await checksumSetting() : checksumSetting, 'WHEN_REQUIRED');
    if (command instanceof HeadObjectCommand) {
      const body = objects.get(command.input.Key);
      if (!body) throw Object.assign(new Error('missing'), { name: 'NotFound' });
      return { ContentLength: body.length, ETag: createHash('md5').update(body).digest('hex') };
    }
    if (command instanceof GetObjectCommand) {
      return {
        Body: { transformToByteArray: async () => objects.get(command.input.Key) || original },
        ContentType: "image/png",
      };
    }
    if (command instanceof PutObjectCommand) {
      puts.push({ key: command.input.Key, body: Buffer.from(command.input.Body) });
      objects.set(command.input.Key, Buffer.from(command.input.Body));
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      deletes.push(command.input.Key);
      return {};
    }
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  };

  const row = {
    id: 595,
    processing_request_id: 0,
    display_mode: 'PROCESSED',
    product_id: 6537,
    original_storage_key: "products/6537/originals/a4653201502-source.png",
    processed_storage_key_1600: null,
    processed_storage_key_1200: null,
    processed_storage_key_800: null,
    processed_storage_key_400: null,
    merchant_storage_key_1500: null,
    image_branding_mode: "FULL_BRANDED",
    article: "A4653201502",
  };
  const completedUpdates = [];
  const publicUpdateTouches = [];
  const db = {
    async query(sql, parameters) {
      const lifecycle = lifecycleQuery(sql); if (lifecycle) return lifecycle;
      if (/SELECT pi\.\*,p.article/.test(sql)) return { rows: [{ ...row }] };
      if (/processed_url_1600=\$2/.test(sql)) {
        completedUpdates.push({ sql, parameters });
        row.processed_storage_key_1600 = parameters[5];
        row.processed_storage_key_1200 = parameters[6];
        row.processed_storage_key_800 = parameters[7];
        row.processed_storage_key_400 = parameters[8];
        row.merchant_storage_key_1500 = parameters[15];
        return { rows: [] };
      }
      if (/processing_status='PROCESSING'/.test(sql)) return { rows: [] };
      if (/UPDATE products/.test(sql) && /updated_at = CURRENT_TIMESTAMP/.test(sql)) {
        publicUpdateTouches.push(parameters[0]);
        return { rows: [{ updated_at: new Date() }] };
      }
      throw new Error(`Unexpected database query: ${sql}`);
    },
  };

  await processProductImageRecord(row.id, db);
  const firstRun = puts.slice(0, 5);
  assert.equal(firstRun.length, 5);
  const firstSite = firstRun.find(({ key }) => /\/processed\/.*-site-1500\.webp$/.test(key));
  const firstMerchant = firstRun.find(({ key }) => /\/merchant\/.*-merchant-1500\.webp$/.test(key));
  assert.ok(firstSite);
  assert.ok(firstMerchant);
  assert.notEqual(firstSite.key, firstMerchant.key);
  assert.equal(firstSite.body.equals(firstMerchant.body), false);
  assert.equal(completedUpdates[0].parameters[14], `https://images.example.test/${firstMerchant.key}`);
  assert.equal(completedUpdates[0].parameters[15], firstMerchant.key);

  row.image_branding_mode = "STAMP_ONLY";
  await processProductImageRecord(row.id, db);
  const secondRun = puts.slice(5);
  assert.equal(secondRun.length, 4, 'identical CLEAN output is reused independently of store branding');
  const secondSite = secondRun.find(({ key }) => /\/processed\/.*-1500\.webp$/.test(key));
  const secondMerchant = firstMerchant;
  assert.ok(secondSite);
  assert.ok(secondMerchant);
  assert.notEqual(secondSite.key, firstSite.key);
  assert.equal(completedUpdates[1].parameters[15], firstMerchant.key);
  assert.equal(secondSite.body.equals(secondMerchant.body), false);
  assert.equal(secondMerchant.body.equals(firstMerchant.body), true);
  assert.equal(deletes.length, 0, 'processing never deletes a published object');
  assert.deepEqual(publicUpdateTouches, [row.product_id, row.product_id]);

  const merchantMetadata = await sharp(secondMerchant.body).metadata();
  assert.equal(merchantMetadata.format, "webp");
  assert.equal(merchantMetadata.width, 1500);
  assert.equal(merchantMetadata.height, 1500);
});

test("SMART SAFE reprocesses from the immutable original and stores review metadata", async (t) => {
  const previousFlag = process.env.SMART_PRODUCT_IMAGES_ENABLED;
  process.env.SMART_PRODUCT_IMAGES_ENABLED = "true";
  t.after(() => {
    if (previousFlag === undefined) delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
    else process.env.SMART_PRODUCT_IMAGES_ENABLED = previousFlag;
  });
  const part = await sharp({
    create: { width: 700, height: 360, channels: 3, background: "#171717" },
  }).png().toBuffer();
  const original = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: "#ffffff" },
  }).composite([{ input: part, left: 450, top: 420 }]).png().toBuffer();
  const puts = [];
  const objects = new Map();
  S3Client.prototype.send = async function send(command) {
    if (command instanceof HeadObjectCommand) {
      const body = objects.get(command.input.Key);
      if (!body) throw Object.assign(new Error('missing'), { name: 'NotFound' });
      return { ContentLength: body.length, ETag: createHash('md5').update(body).digest('hex') };
    }
    if (command instanceof GetObjectCommand) {
      if (command.input.Key.includes('previous-')) throw Object.assign(new Error('missing'), { name: 'NotFound' });
      assert.equal(command.input.Key, "products/91/originals/source.png");
      return { Body: { transformToByteArray: async () => original }, ContentType: "image/png" };
    }
    if (command instanceof PutObjectCommand) {
      puts.push({ key: command.input.Key, body: Buffer.from(command.input.Body) });
      objects.set(command.input.Key, Buffer.from(command.input.Body));
      return {};
    }
    if (command instanceof DeleteObjectCommand) return {};
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  };

  const completedUpdates = [];
  const row = {
    id: 17,
    processing_request_id: 0,
    product_id: 91,
    original_storage_key: "products/91/originals/source.png",
    processed_storage_key_1600: "products/91/processed/previous-1500.webp",
    processed_storage_key_1200: null,
    processed_storage_key_800: null,
    processed_storage_key_400: null,
    merchant_storage_key_1500: null,
    image_branding_mode: "FULL_BRANDED",
    image_processing_mode: "SMART_SAFE",
    image_processing_config: { cropPaddingRatio: 0.08 },
    article: "A0000000091",
  };
  const db = {
    async query(sql, parameters) {
      const lifecycle = lifecycleQuery(sql); if (lifecycle) return lifecycle;
      if (/SELECT pi\.\*,p.article/.test(sql)) return { rows: [{ ...row }] };
      if (/processed_url_1600=\$2/.test(sql)) {
        completedUpdates.push({ sql, parameters });
        return { rows: [] };
      }
      if (/processing_status='PROCESSING'/.test(sql)) return { rows: [] };
      if (/UPDATE products/.test(sql) && /updated_at = CURRENT_TIMESTAMP/.test(sql)) {
        return { rows: [{ updated_at: new Date() }] };
      }
      throw new Error(`Unexpected database query: ${sql}`);
    },
  };

  await processProductImageRecord(row.id, db);

  assert.equal(puts.length, 5);
  const site = puts.find(({ key }) => /\/processed\/.*-1500\.webp$/.test(key));
  const merchant = puts.find(({ key }) => /\/merchant\/.*-merchant-1500\.webp$/.test(key));
  assert.ok(site);
  assert.ok(merchant);
  assert.equal(site.body.equals(merchant.body), false, "site output must retain MAKA branding");
  assert.equal(completedUpdates[0].parameters[16], 5);
  assert.equal(completedUpdates[0].parameters[17], "APPROVED");
  assert.equal(completedUpdates[0].parameters[18], null);
});

test("smart upload preview is read-only and requires the feature flag", async (t) => {
  const source = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: "#ffffff" },
  }).composite([{
    input: await sharp({
      create: { width: 500, height: 300, channels: 3, background: "#222222" },
    }).png().toBuffer(),
    left: 350,
    top: 300,
  }]).png().toBuffer();
  const file = { mimetype: "image/png", buffer: source };
  const queries = [];
  const db = {
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      return { rows: [{ exists: 1 }] };
    },
  };
  const previousFlag = process.env.SMART_PRODUCT_IMAGES_ENABLED;
  delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
  t.after(() => {
    if (previousFlag === undefined) delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
    else process.env.SMART_PRODUCT_IMAGES_ENABLED = previousFlag;
  });

  await assert.rejects(
    ProductImageService.previewUpload(22, file, { processingMode: "SMART_SAFE" }, db),
    /временно отключена/,
  );
  process.env.SMART_PRODUCT_IMAGES_ENABLED = "true";
  const preview = await ProductImageService.previewUpload(22, file, {
    processingMode: "SMART_SAFE",
    cropPaddingRatio: 0.08,
  }, db);

  assert.match(preview.preview, /^data:image\/webp;base64,/);
  assert.match(preview.previewToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(preview.metadata.processingMode, "SMART_SAFE");
  assert.equal(preview.metadata.brandingMode, "FULL_BRANDED");
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /^SELECT 1 FROM products/);
  assert.match(queries[1].sql, /^SELECT 1 FROM products/);
});

test("manual PRODUCT FOCUS preview is available with the automatic flag off, but still requires valid bounds", async (t) => {
  const previousFlag = process.env.SMART_PRODUCT_IMAGES_ENABLED;
  delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
  t.after(() => {
    if (previousFlag === undefined) delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
    else process.env.SMART_PRODUCT_IMAGES_ENABLED = previousFlag;
  });
  const file = { mimetype: "image/png", buffer: await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#ffffff" },
  }).png().toBuffer() };
  const db = { query: async () => ({ rows: [{ exists: 1 }] }) };
  const settings = { processingMode: "PRODUCT_FOCUS", crop: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 }, cropPaddingRatio: 0.06 };
  const wireSettings = { ...settings, crop: JSON.stringify(settings.crop), cropPaddingRatio: "0.06", brandingMode: "FULL_BRANDED" };
  const preview = await ProductImageService.previewUpload(22, file, wireSettings, db);
  assert.match(preview.preview, /^data:image\/webp;base64,/);
  const expected = await processProductImage(file.buffer, preview.processing);
  assert.deepEqual(Buffer.from(preview.preview.split(',')[1], 'base64'), expected.variants[1500],
    'confirmed manual preview must use the exact storefront processing settings');
  assert.match(preview.previewToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(preview.metadata.processingMode, "PRODUCT_FOCUS");
  await assert.rejects(ProductImageService.upload(22, [file], settings, db),
    /Сначала проверь и подтверди предварительный просмотр/);
  await assert.rejects(ProductImageService.upload(22, [file], {
    ...settings, crop: { left: 0.2, top: 0.1, width: 0.7, height: 0.8 }, previewToken: preview.previewToken,
  }, db), /Сначала проверь и подтверди предварительный просмотр/);
  let reachedPublicationQuery = false;
  await assert.rejects(ProductImageService.upload(22, [file], {
    ...wireSettings, previewToken: preview.previewToken,
  }, { query: async () => { reachedPublicationQuery = true; return { rows: [] }; } }), /Товар не найден/);
  assert.equal(reachedPublicationQuery, true, "confirmed manual settings pass the publication gate with the flag off");
  await assert.rejects(ProductImageService.previewUpload(22, file, { processingMode: "PRODUCT_FOCUS" }, db), /выбери область кадра/);
  await assert.rejects(ProductImageService.previewUpload(22, file, { processingMode: "PRODUCT_MAX", crop: settings.crop }, db), /временно отключена/);
});

test("an existing photo without an original cannot be silently cropped from its public derivative", async () => {
  const queries = [];
  const db = { async query(sql, parameters) { queries.push({ sql, parameters }); return { rows: [{ original_storage_key: null }] }; } };
  await assert.rejects(ProductImageService.previewExisting(22, 48, {
    processingMode: "PRODUCT_FOCUS", crop: { left: 0, top: 0, width: 1, height: 1 },
  }, db), /Оригинал изображения не найден/);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /^SELECT original_storage_key/);
});

test("a confirmed manual crop is not downgraded to LEGACY by the background worker", async (t) => {
  const previousFlag = process.env.SMART_PRODUCT_IMAGES_ENABLED;
  delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
  t.after(() => {
    if (previousFlag === undefined) delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
    else process.env.SMART_PRODUCT_IMAGES_ENABLED = previousFlag;
  });
  const row = {
    id: 48, product_id: 22, article: "A0000000022", processing_request_id: 0,
    original_storage_key: "products/22/originals/source.png", original_url: "https://images.example.test/source.png",
    image_processing_mode: "PRODUCT_FOCUS", image_processing_config: {
      crop: { left: 0, top: 0, width: 0.48, height: 1 }, cropPaddingRatio: 0.06,
    }, image_branding_mode: "STAMP_ONLY", display_mode: "ORIGINAL",
  };
  const redPart = await sharp({ create: { width: 260, height: 260, channels: 3, background: "#d12336" } }).png().toBuffer();
  const bluePart = await sharp({ create: { width: 260, height: 260, channels: 3, background: "#1737ac" } }).png().toBuffer();
  const original = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#ffffff" } })
    .composite([{ input: redPart, left: 90, top: 170 }, { input: bluePart, left: 550, top: 170 }]).png().toBuffer();
  const objects = new Map([[row.original_storage_key, original]]);
  const storage = {
    publicUrl: key => `https://images.example.test/${key}`,
    read: async key => objects.get(key),
    verify: async (key, body) => {
      if (!objects.get(key)?.equals(body)) throw Object.assign(new Error("missing"), { name: "NotFound" });
    },
    uploadWebp: async (key, body) => { objects.set(key, body); },
  };
  let published;
  const db = { async query(sql, parameters) {
    const lifecycle = lifecycleQuery(sql); if (lifecycle) return lifecycle;
    if (/SELECT pi\.\*,p.article/.test(sql)) return { rows: [{ ...row }] };
    if (/processed_url_1600=\$2/.test(sql)) published = { sql, parameters };
    return { rows: [{ processing_request_id: 0, updated_at: new Date() }] };
  } };
  assert.deepEqual(await processProductImageRecord(row.id, db, { storage }), { processed: true, reused: false });
  assert.ok(published?.sql.includes("display_mode='PROCESSED'"));
  const site = objects.get(published.parameters[5]);
  const merchant = objects.get(published.parameters[15]);
  const expected = await processProductImage(original, {
    processingMode: "PRODUCT_FOCUS", brandingMode: "STAMP_ONLY", ...row.image_processing_config,
  });
  const legacy = await processProductImage(original, { processingMode: "LEGACY", brandingMode: "STAMP_ONLY" });
  assert.ok(site.equals(expected.variants[1500]), "the published site file uses the confirmed manual crop");
  assert.ok(!site.equals(legacy.variants[1500]), "the worker must not publish a LEGACY fallback");
  assert.ok(merchant.equals(expected.merchant.variant), "the clean Merchant file uses the same manual crop");
  assert.equal((await sharp(site).metadata()).width, 1500);
  assert.ok(objects.get(row.original_storage_key).equals(original), "the original remains unchanged");
});

test("PRODUCT MAX is preferred only while the existing smart-processing flag is enabled", async (t) => {
  const previousFlag = process.env.SMART_PRODUCT_IMAGES_ENABLED;
  t.after(() => {
    if (previousFlag === undefined) delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
    else process.env.SMART_PRODUCT_IMAGES_ENABLED = previousFlag;
  });

  delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
  assert.deepEqual(ProductImageService.capabilities(), {
    smartProcessing: false,
    manualProcessing: true,
    preferredMode: "LEGACY",
    modes: ["PRODUCT_MAX", "SMART_SAFE", "PRODUCT_FOCUS"],
  });

  process.env.SMART_PRODUCT_IMAGES_ENABLED = "true";
  assert.deepEqual(ProductImageService.capabilities(), {
    smartProcessing: true,
    manualProcessing: true,
    preferredMode: "PRODUCT_MAX",
    modes: ["PRODUCT_MAX", "SMART_SAFE", "PRODUCT_FOCUS"],
  });

  const source = await sharp({
    create: { width: 400, height: 400, channels: 3, background: "#ffffff" },
  }).composite([{
    input: await sharp({
      create: { width: 180, height: 120, channels: 3, background: "#222222" },
    }).png().toBuffer(),
    left: 110,
    top: 140,
  }]).png().toBuffer();
  const db = { query: async () => ({ rows: [{ exists: 1 }] }) };
  const preview = await ProductImageService.previewUpload(22, {
    mimetype: "image/png",
    buffer: source,
  }, {}, db);

  assert.equal(preview.metadata.processingMode, "PRODUCT_MAX");
  assert.equal(preview.metadata.processingVersion, 6);
  assert.equal(preview.metadata.qualityStatus, "LOW_RESOLUTION");
  assert.ok(preview.metadata.contentFillRatio >= 0.86);
});

test("smart publication requires the exact confirmed preview and one file", async (t) => {
  const previousFlag = process.env.SMART_PRODUCT_IMAGES_ENABLED;
  process.env.SMART_PRODUCT_IMAGES_ENABLED = "true";
  t.after(() => {
    if (previousFlag === undefined) delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
    else process.env.SMART_PRODUCT_IMAGES_ENABLED = previousFlag;
  });

  const source = await sharp({
    create: { width: 900, height: 700, channels: 3, background: "#ffffff" },
  }).composite([{
    input: await sharp({
      create: { width: 420, height: 260, channels: 3, background: "#222222" },
    }).png().toBuffer(),
    left: 240,
    top: 220,
  }]).png().toBuffer();
  const file = { mimetype: "image/png", buffer: source };
  let queryCount = 0;
  const previewDb = {
    async query() {
      queryCount += 1;
      return { rows: [{ exists: 1 }] };
    },
  };
  const settings = { processingMode: "PRODUCT_MAX", cropPaddingRatio: 0.045 };
  const preview = await ProductImageService.previewUpload(22, file, settings, previewDb);

  await assert.rejects(
    ProductImageService.upload(22, [file], settings, previewDb),
    /Сначала проверь и подтверди предварительный просмотр/,
  );
  await assert.rejects(
    ProductImageService.upload(22, [file, file], { ...settings, previewToken: preview.previewToken }, previewDb),
    /Подтверди каждое Smart-фото отдельно/,
  );
  await assert.rejects(
    ProductImageService.upload(22, [file], {
      ...settings,
      brandingMode: "CLEAN",
      previewToken: preview.previewToken,
    }, previewDb),
    /Сначала проверь и подтверди предварительный просмотр/,
  );
  await assert.rejects(
    ProductImageService.upload(22, [{ ...file, buffer: Buffer.from(source).fill(0, 0, 1) }], {
      ...settings,
      previewToken: preview.previewToken,
    }, previewDb),
    /Сначала проверь и подтверди предварительный просмотр/,
  );
  assert.equal(queryCount, 1, "rejected publication must not query the database or write storage");
});

test("manual crop validation rejects unsafe normalized bounds before preview processing", async (t) => {
  const previousFlag = process.env.SMART_PRODUCT_IMAGES_ENABLED;
  process.env.SMART_PRODUCT_IMAGES_ENABLED = "true";
  t.after(() => {
    if (previousFlag === undefined) delete process.env.SMART_PRODUCT_IMAGES_ENABLED;
    else process.env.SMART_PRODUCT_IMAGES_ENABLED = previousFlag;
  });
  const file = {
    mimetype: "image/png",
    buffer: await sharp({
      create: { width: 400, height: 400, channels: 3, background: "#ffffff" },
    }).png().toBuffer(),
  };
  const db = { query: async () => ({ rows: [{ exists: 1 }] }) };

  await assert.rejects(
    ProductImageService.previewUpload(22, file, {
      processingMode: "PRODUCT_FOCUS",
      crop: { left: 0.9, top: 0, width: 0.2, height: 1 },
    }, db),
    /Некорректная область кадра/,
  );
});
