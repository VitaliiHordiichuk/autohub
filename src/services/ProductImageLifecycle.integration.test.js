import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { pool } from '../config/db.js';
import { ProductImageService, processProductImageRecord, processMerchantImageRecord } from './ProductImageService.js';
import { IMAGE_SLOTS, rememberOriginal, resolvePublishedImage } from './ProductImageLifecycle.js';
import { collectProductImageGarbage } from './ProductImageGarbageCollector.js';
import { createProductMediaRouter } from '../routes/product-media.routes.js';

// Real PostgreSQL transactions/locks; R2 is ALWAYS replaced with an in-memory store.
const enabled = process.env.NODE_ENV === 'test' && /_test$/.test(process.env.DB_NAME || '')
  && ['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST);
let row, storage, objects, uploads, deletes, productId;
const originals = {};
const env = ['PRODUCT_IMAGE_DELIVERY_BASE_URL','PRODUCT_IMAGE_GC_ENABLED','R2_ENDPOINT','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_PUBLIC_BASE_URL'];

before(async () => {
  assert.ok(enabled, 'Run through npm test: isolated local *_test PostgreSQL required');
  for (const name of env) originals[name] = process.env[name];
  Object.assign(process.env, {
    PRODUCT_IMAGE_DELIVERY_BASE_URL: 'https://maka.example.test/api/product-media', PRODUCT_IMAGE_GC_ENABLED: 'true',
    R2_ENDPOINT: 'https://r2.example.test', R2_BUCKET: 'test', R2_ACCESS_KEY_ID: 'test',
    R2_SECRET_ACCESS_KEY: 'test', R2_PUBLIC_BASE_URL: 'https://r2.example.test',
  });
  productId = (await pool.query('SELECT id FROM products ORDER BY id LIMIT 1')).rows[0].id;
});

beforeEach(async () => {
  if (!enabled) return;
  objects = new Map(); uploads = []; deletes = [];
  const key = `products/${productId}/originals/lifecycle-${randomUUID()}.jpg`;
  const inserted = await pool.query(`INSERT INTO product_images(product_id,url,original_url,original_storage_key,source,processing_status,display_mode)
    VALUES($1,$2,$2,$3,'TEST','PROCESSED','PROCESSED') RETURNING *`, [productId, `https://old.example.test/${key}`, key]);
  row = inserted.rows[0];
  objects.set(key, Buffer.from('immutable original'));
  for (const slot of IMAGE_SLOTS) {
    const oldKey = `products/${productId}/${slot.role.startsWith('merchant') ? 'merchant' : 'processed'}/legacy-${row.id}-${slot.role}.webp`;
    await pool.query(`UPDATE product_images SET ${slot.key}=$2,${slot.url}=$3 WHERE id=$1`, [row.id, oldKey, `https://old.example.test/${oldKey}`]);
    objects.set(oldKey, Buffer.from(`old:${slot.role}`));
  }
  await pool.query('UPDATE product_images SET url=processed_url_1600,storage_key=processed_storage_key_1600 WHERE id=$1', [row.id]);
  row = await current();
  storage = {
    read: async key => { if (!objects.has(key)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' }); return objects.get(key); },
    head: async key => ({ ContentLength: (await storage.read(key)).length }),
    verify: async (key, body) => assert.deepEqual(await storage.read(key), body),
    uploadWebp: async (key, body) => { assert.ok(!objects.has(key), 'never overwrite'); objects.set(key, body); uploads.push(key); },
    remove: async key => { deletes.push(key); objects.delete(key); },
    publicUrl: key => `https://r2.example.test/${key}`,
  };
});

afterEach(async () => {
  if (!enabled || !row) return;
  await pool.query('DELETE FROM product_images WHERE id=$1', [row.id]);
  await pool.query('DELETE FROM product_image_objects WHERE image_id=$1', [row.id]);
});
after(async () => {
  for (const name of env) {
    if (originals[name] === undefined) delete process.env[name]; else process.env[name] = originals[name];
  }
  await pool.end();
});

async function current() { return (await pool.query('SELECT * FROM product_images WHERE id=$1', [row.id])).rows[0]; }
function output(version = 'v1') {
  return { variants: Object.fromEntries([1500,1200,800,400].map(size => [size, Buffer.from(`${version}:store:${size}`)])),
    merchant: { variant: Buffer.from(`${version}:clean`) }, metadata: { originalWidth: 1000, originalHeight: 800,
      processedWidth: 1500, processedHeight: 1500, qualityStatus: 'GOOD' } };
}
const run = (version = 'v1', db = pool) => processProductImageRecord(row.id, db, { storage, process: async () => output(version) });
function samePublished(a, b) {
  for (const field of ['url','storage_key','display_mode','original_url','original_storage_key', ...IMAGE_SLOTS.flatMap(s => [s.key,s.url])]) assert.equal(a[field], b[field], field);
}
async function ageGarbage() { await pool.query("UPDATE product_image_objects SET delete_after=NOW()-INTERVAL '1 day' WHERE image_id=$1 AND state<>'CURRENT'", [row.id]); }
function faultPool(inject) {
  return { connect: async () => {
    const session = await pool.connect();
    return { query: (sql, args) => inject(sql, args, session), release: error => session.release(error) };
  } };
}

test('all derivatives verified before atomic publication; identical bytes preserve URLs and issue zero PUTs', async () => {
  await run();
  const first = await current();
  assert.equal(uploads.length, 5);
  assert.equal(deletes.length, 0);
  assert.match(first.merchant_url_1500, /\/merchant-1500\/[a-f0-9]{64}\.webp$/);
  assert.notEqual(first.merchant_url_1500, first.url);
  assert.equal((await storage.read(first.merchant_storage_key_1500)).toString(), 'v1:clean');
  const result = await run();
  assert.equal(result.reused, true);
  assert.equal(uploads.length, 5);
  samePublished(await current(), first);
  assert.equal(objects.get(row.original_storage_key).toString(), 'immutable original');
});

test('reprocessing keeps storefront URL; unchanged CLEAN bytes retain Merchant URL', async () => {
  await run('v1');
  const first = await current();
  assert.ok(first.url.endsWith(`/api/product-media/${row.id}/site-1500/current.webp`));
  assert.match(first.merchant_url_1500, /\/merchant-1500\/[a-f0-9]{64}\.webp$/);
  const oldHash = (await pool.query(
    'SELECT sha256 FROM product_image_objects WHERE storage_key=$1', [first.processed_storage_key_1600]
  )).rows[0].sha256;
  const previousUrl = `https://maka.example.test/api/product-media/${row.id}/site-1500/${oldHash}.webp`;
  const revised = output('v2');
  revised.merchant = output('v1').merchant;
  await processProductImageRecord(row.id, pool, { storage, process: async () => revised });
  const second = await current();
  assert.equal(second.url, first.url);
  assert.equal(second.processed_url_400, first.processed_url_400);
  assert.equal(second.merchant_url_1500, first.merchant_url_1500);
  assert.notEqual(second.processed_storage_key_1600, first.processed_storage_key_1600);
  assert.equal(uploads.length, 9, 'No extra Merchant PUT when CLEAN bytes are identical');

  const app = express();
  app.use('/api/product-media', createProductMediaRouter({ db: pool, storageFactory: () => storage }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const stable = base + new URL(first.url).pathname;
    const response = await fetch(stable);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, no-cache, must-revalidate');
    assert.equal(await response.text(), 'v2:store:1500');
    const etag = response.headers.get('etag');
    const unchanged = await fetch(stable, { headers: { 'If-None-Match': etag, 'Cache-Control': 'no-cache' } });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.headers.get('etag'), etag);
    const stale = await fetch(stable, { headers: { 'If-None-Match': '"older-version"' } });
    assert.equal(stale.status, 200);
    assert.equal(await stale.text(), 'v2:store:1500');

    const previous = await fetch(base + new URL(previousUrl).pathname, { redirect: 'manual' });
    assert.equal(previous.status, 302);
    assert.equal((await fetch(base + new URL(previousUrl).pathname)).status, 200);
    const head = await fetch(stable, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength('v2:store:1500'));
    assert.equal((await fetch(`${base}/api/product-media/${row.id}/merchant-1500/current.webp`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('identical pre-migration UUID objects also retain original URLs', async () => {
  const out = output();
  for (const slot of IMAGE_SLOTS) objects.set(row[slot.key], slot.role === 'merchant-1500' ? out.merchant.variant : out.variants[slot.size]);
  await run();
  assert.equal(uploads.length, 0);
  samePublished(await current(), row);
});

test('upload failure including a successful PUT with lost acknowledgement retains previous working images and durable intent', async () => {
  const put = storage.uploadWebp;
  storage.uploadWebp = async (key, body) => { await put(key, body); if (uploads.length === 3) throw new Error('lost PUT response'); };
  await assert.rejects(run(), /lost PUT response/);
  samePublished(await current(), row);
  const staged = await pool.query("SELECT storage_key FROM product_image_objects WHERE image_id=$1 AND state='STAGED'", [row.id]);
  assert.equal(staged.rows.length, 3);
  assert.equal(deletes.length, 0);
});

test('verification failure never publishes partial output', async () => {
  const verify = storage.verify;
  storage.verify = async (key, body) => { await verify(key, body); if (uploads.length === 5) throw new Error('checksum mismatch'); };
  await assert.rejects(run(), /checksum mismatch/);
  samePublished(await current(), row);
});

test('processor failure preserves the previous display mode, store URLs and CLEAN image', async () => {
  await assert.rejects(processProductImageRecord(row.id, pool, { storage, process: async () => { throw new Error('decoder failed'); } }), /decoder failed/);
  samePublished(await current(), row);
  assert.equal(uploads.length, 0);
  assert.equal(deletes.length, 0);
});

test('product touch failure rolls back keys and URLs as part of the same transaction', async () => {
  const db = faultPool((sql, args, session) => /UPDATE products/.test(sql) ? Promise.reject(new Error('touch failed')) : session.query(sql,args));
  await assert.rejects(run('v1', db), /touch failed/);
  samePublished(await current(), row);
  assert.equal(deletes.length, 0);
});

test('ambiguous COMMIT success does not delete new published files or reset to ORIGINAL', async () => {
  const db = faultPool(async (sql, args, session) => { const result = await session.query(sql,args); if (sql === 'COMMIT') throw new Error('lost COMMIT response'); return result; });
  await assert.rejects(run('v1', db), /lost COMMIT response/);
  const published = await current();
  assert.notEqual(published.url, row.url);
  assert.equal(published.processing_status, 'PROCESSED');
  for (const slot of IMAGE_SLOTS) assert.ok(objects.has(published[slot.key]));
  assert.equal(deletes.length, 0);
});

test('two concurrent workers serialize; a newer generation wins without stale publication', async () => {
  let unblock, reached;
  const ready = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { unblock = resolve; });
  const slow = processProductImageRecord(row.id, pool, { storage, process: async () => { reached(); await gate; return output('stale'); } });
  await ready;
  assert.equal((await run('duplicate')).busy, true);
  await pool.query('UPDATE product_images SET processing_request_id=processing_request_id+1 WHERE id=$1', [row.id]);
  unblock();
  assert.equal((await slow).superseded, true);
  samePublished(await current(), row);
  await run('newest');
  assert.equal((await storage.read((await current()).merchant_storage_key_1500)).toString(), 'newest:clean');
});

test('GC is dry-run by default; originals, current objects and directly published legacy URLs remain protected', async () => {
  await run(); await run('v2'); await ageGarbage();
  const dry = await collectProductImageGarbage({}, { db: pool, storage });
  assert.equal(dry.results.filter(r => r.result === 'eligible').length, 5);
  assert.equal(deletes.length, 0);
  const published = await current();
  await collectProductImageGarbage({ apply: true }, { db: pool, storage });
  assert.equal(deletes.length, 5);
  for (const slot of IMAGE_SLOTS) { assert.ok(objects.has(published[slot.key])); assert.ok(objects.has(row[slot.key])); }
  assert.ok(objects.has(row.original_storage_key));
});

test('deletion errors persist and retry; identical reprocessing can safely revive a collected content hash', async () => {
  await run(); const v1 = await current(); await run('v2'); await ageGarbage();
  const remove = storage.remove;
  storage.remove = async () => { throw new Error('R2 delete unavailable'); };
  const failed = await collectProductImageGarbage({ apply: true }, { db: pool, storage });
  assert.ok(failed.results.every(r => r.result === 'retry'));
  const ledger = await pool.query("SELECT last_error FROM product_image_objects WHERE image_id=$1 AND state='DELETING'", [row.id]);
  assert.equal(ledger.rows.length, 5);
  storage.remove = remove; await ageGarbage();
  await collectProductImageGarbage({ apply: true }, { db: pool, storage });
  assert.ok(!objects.has(v1.processed_storage_key_1600));
  await run('v1');
  samePublished(await current(), v1);
});

test('reference recheck and unavailable replacements prevent deletion', async () => {
  await run(); const v1 = await current(); await run('v2'); await ageGarbage();
  await pool.query('UPDATE product_images SET original_url=$2 WHERE id=$1', [row.id, storage.publicUrl(v1.processed_storage_key_400)]);
  const head = storage.head; storage.head = async () => { throw new Error('replacement unavailable'); };
  const result = await collectProductImageGarbage({ apply: true }, { db: pool, storage });
  assert.ok(result.results.some(r => r.result === 'referenced'));
  assert.equal(deletes.length, 0);
  storage.head = head;
});

test('incorrect ledger state cannot authorize deleting current keys or an original path', async () => {
  await run();
  const published = await current();
  await pool.query(`UPDATE product_image_objects SET state='RETIRED',legacy_public=FALSE,
    role=CASE WHEN role='original' THEN 'site-400' ELSE role END,delete_after=NOW()-INTERVAL '1 day'
    WHERE storage_key=ANY($1::text[])`, [[row.original_storage_key,published.processed_storage_key_1600]]);
  const result = await collectProductImageGarbage({ apply: true }, { db: pool, storage });
  assert.ok(result.results.some(r => r.result === 'unmanaged'));
  assert.ok(result.results.some(r => r.result === 'referenced'));
  assert.equal(deletes.length, 0);
});

test('old managed store and Merchant URLs redirect directly to current bytes after old physical files are collected', async () => {
  await run(); const v1 = await current(); await run('v2'); await ageGarbage();
  const v2 = await current();
  assert.equal(v2.url, v1.url, 'the storefront URL stays stable when both outputs change');
  assert.notEqual(v2.merchant_url_1500, v1.merchant_url_1500, 'changed CLEAN bytes get a new Merchant URL');
  await collectProductImageGarbage({ apply: true }, { db: pool, storage });
  const app = express(); app.use('/api/product-media', createProductMediaRouter({ db: pool, storageFactory: () => storage }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const slot of [IMAGE_SLOTS[0], IMAGE_SLOTS[4]]) {
      const previousHash = (await pool.query(
        'SELECT sha256 FROM product_image_objects WHERE storage_key=$1', [v1[slot.key]]
      )).rows[0].sha256;
      const url = `${base}/api/product-media/${row.id}/${slot.role}/${previousHash}.webp`;
      const redirect = await fetch(url, { redirect: 'manual' }); assert.equal(redirect.status, 302);
      assert.ok(!redirect.headers.get('location').includes('.r2.'));
      const response = await fetch(url); assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /image\/webp/);
      assert.equal(await response.text(), slot.role === 'merchant-1500' ? 'v2:clean' : 'v2:store:1500');
      const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.status, 200);
    }
    assert.equal((await fetch(`${base}/api/product-media/${row.id}/original/${'f'.repeat(64)}.webp`)).status, 404);
    assert.equal(await resolvePublishedImage(pool,row.id,'site-1500','f'.repeat(64)), null);
    const currentMerchant = await current();
    const read = storage.read;
    storage.read = async key => key === currentMerchant.merchant_storage_key_1500 ? Buffer.from('corrupted') : read(key);
    const corrupted = await fetch(base + new URL(currentMerchant.merchant_url_1500).pathname);
    assert.equal(corrupted.status, 503);
    assert.equal(corrupted.headers.get('cache-control'), 'no-store');
    const corruptHead = await fetch(base + new URL(currentMerchant.merchant_url_1500).pathname, { method: 'HEAD' });
    assert.equal(corruptHead.status, 503);
    storage.read = async () => { throw new Error('temporary error'); };
    const unavailable = await fetch(base + new URL((await current()).url).pathname);
    assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get('cache-control'), 'no-store');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('explicit image removal detaches from storefront, preserves original and does no immediate R2 deletion', async () => {
  await run();
  await ProductImageService.remove(productId, row.id, pool);
  assert.equal(await current(), undefined);
  assert.equal(deletes.length, 0);
  const original = await pool.query("SELECT * FROM product_image_objects WHERE image_id=$1 AND role='original'", [row.id]);
  assert.equal(original.rows.length, 1); assert.equal(original.rows[0].state, 'CURRENT');
});

test('an interrupted original upload remains a protected, identifiable intent, not a published photo', async () => {
  const key = `products/${productId}/originals/interrupted-${row.id}.jpg`;
  await rememberOriginal(pool, { key, imageId: row.id, productId, body: Buffer.from('original'), url: storage.publicUrl(key), pending: true });
  await ageGarbage();
  const record = (await pool.query('SELECT * FROM product_image_objects WHERE storage_key=$1', [key])).rows[0];
  assert.equal(record.state, 'STAGED');
  const garbage = await collectProductImageGarbage({ apply: true }, { db: pool, storage });
  assert.ok(!garbage.results.some(item => item.key === key));
  samePublished(await current(), row);
});

test('Merchant-only backfill uses the same verified atomic lifecycle and does not change branded store images', async () => {
  await pool.query('UPDATE product_images SET merchant_url_1500=NULL,merchant_storage_key_1500=NULL WHERE id=$1', [row.id]);
  const result = await processMerchantImageRecord(row.id, pool, { storage, processMerchant: async () => ({ variant: Buffer.from('merchant-only') }) });
  assert.equal(result.processed, true);
  const updated = await current();
  assert.equal(updated.url, row.url);
  assert.equal(updated.processed_storage_key_1600, row.processed_storage_key_1600);
  assert.equal((await storage.read(updated.merchant_storage_key_1500)).toString(), 'merchant-only');
  assert.equal(uploads.length, 1);
  assert.equal((await processMerchantImageRecord(row.id, pool, { storage })).skipped, 'already_has_merchant');
});
