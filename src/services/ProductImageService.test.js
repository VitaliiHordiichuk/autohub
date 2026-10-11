import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

import { ProductImageService, processProductImageRecord } from "./ProductImageService.js";

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
  S3Client.prototype.send = async function send(command) {
    if (command instanceof GetObjectCommand) {
      return {
        Body: { transformToByteArray: async () => original },
        ContentType: "image/png",
      };
    }
    if (command instanceof PutObjectCommand) {
      puts.push({ key: command.input.Key, body: Buffer.from(command.input.Body) });
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
      if (/SELECT pi\.id,pi\.product_id/.test(sql)) return { rows: [{ ...row }] };
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
  const firstSite = firstRun.find(({ key }) => /\/processed\/.*-1500\.webp$/.test(key));
  const firstMerchant = firstRun.find(({ key }) => /\/merchant\/.*-clean-1500\.webp$/.test(key));
  assert.ok(firstSite);
  assert.ok(firstMerchant);
  assert.notEqual(firstSite.key, firstMerchant.key);
  assert.equal(firstSite.body.equals(firstMerchant.body), false);
  assert.equal(completedUpdates[0].parameters[14], `https://images.example.test/${firstMerchant.key}`);
  assert.equal(completedUpdates[0].parameters[15], firstMerchant.key);

  row.image_branding_mode = "STAMP_ONLY";
  await processProductImageRecord(row.id, db);
  const secondRun = puts.slice(5, 10);
  assert.equal(secondRun.length, 5);
  const secondSite = secondRun.find(({ key }) => /\/processed\/.*-1500\.webp$/.test(key));
  const secondMerchant = secondRun.find(({ key }) => /\/merchant\/.*-clean-1500\.webp$/.test(key));
  assert.ok(secondSite);
  assert.ok(secondMerchant);
  assert.notEqual(secondSite.key, firstSite.key);
  assert.notEqual(secondMerchant.key, firstMerchant.key);
  assert.equal(secondSite.body.equals(secondMerchant.body), false);
  assert.equal(secondMerchant.body.equals(firstMerchant.body), true);
  assert.ok(deletes.includes(firstMerchant.key));
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
  S3Client.prototype.send = async function send(command) {
    if (command instanceof GetObjectCommand) {
      assert.equal(command.input.Key, "products/91/originals/source.png");
      return { Body: { transformToByteArray: async () => original }, ContentType: "image/png" };
    }
    if (command instanceof PutObjectCommand) {
      puts.push({ key: command.input.Key, body: Buffer.from(command.input.Body) });
      return {};
    }
    if (command instanceof DeleteObjectCommand) return {};
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  };

  const completedUpdates = [];
  const row = {
    id: 17,
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
      if (/SELECT pi\.id,pi\.product_id/.test(sql)) return { rows: [{ ...row }] };
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
  const merchant = puts.find(({ key }) => /\/merchant\/.*-clean-1500\.webp$/.test(key));
  assert.ok(site);
  assert.ok(merchant);
  assert.equal(site.body.equals(merchant.body), true, "smart output must not add a watermark");
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
  assert.equal(preview.metadata.brandingMode, "CLEAN");
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /^SELECT 1 FROM products/);
  assert.match(queries[1].sql, /^SELECT 1 FROM products/);
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
    preferredMode: "LEGACY",
    modes: ["PRODUCT_MAX", "SMART_SAFE", "PRODUCT_FOCUS"],
  });

  process.env.SMART_PRODUCT_IMAGES_ENABLED = "true";
  assert.deepEqual(ProductImageService.capabilities(), {
    smartProcessing: true,
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
