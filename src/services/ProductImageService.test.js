import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

import { processProductImageRecord } from "./ProductImageService.js";

const environmentNames = [
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
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

  const merchantMetadata = await sharp(secondMerchant.body).metadata();
  assert.equal(merchantMetadata.format, "webp");
  assert.equal(merchantMetadata.width, 1500);
  assert.equal(merchantMetadata.height, 1500);
});
