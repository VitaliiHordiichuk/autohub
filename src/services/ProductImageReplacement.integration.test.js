import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { pool } from '../config/db.js';
import { IMAGE_SLOTS, resolvePublishedImage } from './ProductImageLifecycle.js';
import { ProductImageService } from './ProductImageService.js';
import { createProductMediaRouter } from '../routes/product-media.routes.js';

// Only real isolated LOCAL PostgreSQL is allowed; R2 is always memory-backed.
const enabled = process.env.NODE_ENV === 'test' && /_test$/.test(process.env.DB_NAME || '')
  && ['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST);
let productId;
let ids = [];
const memory = new Map();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const storage = {
  read: async key => {
    if (!memory.has(key)) throw Object.assign(new Error('missing R2 object'), { name: 'NoSuchKey' });
    return memory.get(key);
  },
  publicUrl: key => `https://legacy-r2.example.test/${key}`,
};

before(async () => {
  assert.ok(enabled, 'Run only through npm test with isolated LOCAL *_test PostgreSQL');
  productId = (await pool.query('SELECT id FROM products ORDER BY id LIMIT 1')).rows[0]?.id;
  assert.ok(productId);
});
after(async () => {
  if (ids.length) {
    await pool.query('DELETE FROM product_image_replacements WHERE old_image_id=ANY($1::bigint[])', [ids]);
    await pool.query('DELETE FROM product_images WHERE id=ANY($1::bigint[])', [ids]);
    await pool.query('DELETE FROM product_image_objects WHERE image_id=ANY($1::bigint[])', [ids]);
  }
  await pool.end();
});

async function insertPhoto({ managed = false, incomplete = false } = {}) {
  const tag = randomUUID();
  const originalKey = `products/${productId}/originals/${tag}.jpg`;
  memory.set(originalKey, Buffer.from(`original:${tag}`));
  const inserted = await pool.query(`INSERT INTO product_images(
    product_id,url,original_url,original_storage_key,source,processing_status,display_mode,
    image_processing_mode,priority)
    VALUES($1,$2,$2,$3,'TEST','PROCESSED','PROCESSED','LEGACY',0) RETURNING id`,
  [productId, storage.publicUrl(originalKey), originalKey]);
  const id = Number(inserted.rows[0].id);
  ids.push(id);
  for (const slot of IMAGE_SLOTS) {
    if (incomplete && slot.role === 'merchant-1500') continue;
    const body = Buffer.from(`bytes:${tag}:${slot.role}`);
    const key = `products/${productId}/processed/${tag}-${slot.role}.webp`;
    memory.set(key, body);
    const url = managed
      ? `https://maka.example.test/api/product-media/${id}/${slot.role}/${sha(body)}.webp`
      : storage.publicUrl(key);
    await pool.query(`UPDATE product_images SET ${slot.key}=$2, ${slot.url}=$3 WHERE id=$1`, [id,key,url]);
    if (managed) await pool.query(`INSERT INTO product_image_objects(
      storage_key,image_id,product_id,role,sha256,byte_size,state,public_url,published_at)
      VALUES($1,$2,$3,$4,$5,$6,'CURRENT',$7,NOW())`,
    [key,id,productId,slot.role,sha(body),body.length,url]);
  }
  await pool.query(`UPDATE product_images
    SET url=COALESCE(processed_url_1600,original_url),storage_key=processed_storage_key_1600
    WHERE id=$1`,[id]);
  return { id, tag };
}

test('replacement preserves archived image while removing it from public catalog and redirecting old managed URLs', async () => {
  const old = await insertPhoto({ managed: true });
  const current = await insertPhoto();
  const oldImage = (await pool.query('SELECT * FROM product_images WHERE id=$1',[old.id])).rows[0];
  const hash = sha(memory.get(oldImage.processed_storage_key_1600));

  await ProductImageService.replace(productId, old.id, current.id, pool, { storage });

  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM product_images WHERE id=$1', [old.id])).rows[0].n, 0);
  const history = await ProductImageService.history(productId, pool);
  const entry = history.find(item => Number(item.old_image_id) === old.id);
  assert.equal(Number(entry.current_image_id), current.id);
  assert.equal(entry.old_preview_url, storage.publicUrl(oldImage.original_storage_key));
  assert.ok(Number(entry.byte_size) > 0);

  const resolved = await resolvePublishedImage(pool, old.id, 'site-1500', hash);
  assert.equal(Number(resolved.current_image_id), current.id);
  assert.ok(memory.has(resolved.storage_key), 'new R2 object remains available');
  assert.equal((await resolvePublishedImage(pool, old.id, 'site-1500', 'f'.repeat(64))), null);
  await assert.rejects(ProductImageService.remove(productId, current.id, pool), /заменой для старых ссылок/);

  const app = express();
  app.use('/api/product-media', createProductMediaRouter({ db: pool, storageFactory: () => storage }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/product-media`;
  try {
    const redirected = await fetch(`${base}/${old.id}/site-1500/${hash}.webp`, { redirect: 'manual' });
    assert.equal(redirected.status, 302);
    assert.equal(redirected.headers.get('location'),
      `/api/product-media/${current.id}/site-1500/${resolved.sha256}.webp`);
    const actual = await fetch(`${base}/${old.id}/site-1500/${hash}.webp`);
    assert.equal(actual.status, 200);
    assert.deepEqual(Buffer.from(await actual.arrayBuffer()), memory.get(resolved.storage_key));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

  const newest = await insertPhoto();
  await ProductImageService.replace(productId, current.id, newest.id, pool, { storage });
  const chained = await resolvePublishedImage(pool, old.id, 'site-1500', hash);
  assert.equal(Number(chained.current_image_id), newest.id);
  assert.equal((await ProductImageService.history(productId, pool)).filter(item =>
    [old.id,current.id].includes(Number(item.old_image_id))).length, 2);
});

test('replacement fails closed for incomplete target without losing active old photo', async () => {
  const old = await insertPhoto();
  const incomplete = await insertPhoto({ incomplete: true });
  await assert.rejects(
    ProductImageService.replace(productId, old.id, incomplete.id, pool, { storage }),
    /пять готовых версий/);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM product_images WHERE id=$1', [old.id])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM product_image_replacements WHERE old_image_id=$1', [old.id])).rows[0].n, 0);
});
