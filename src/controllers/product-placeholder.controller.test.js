import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { createProductPlaceholderHandler } from './product-placeholder.controller.js';
import { ProductPlaceholderService } from '../services/ProductPlaceholderService.js';
import { primaryImageAliasEnabled, readPrimaryImageAlias } from '../services/ProductPrimaryImageAliasService.js';

const product = { id: 451, article: 'A4513230340', article_normalized: 'A4513230340', name: 'Кронштейн' };
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const key = 'products/451/processed/main-photo.webp';

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    set(name, value) {
      for (const [key, item] of Object.entries(typeof name === 'object' ? name : { [name]: value })) {
        this.headers[key.toLowerCase()] = item;
      }
      return this;
    },
    status(value) { this.statusCode = value; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

function fixture(selectedProduct = product) {
  const state = { product: selectedProduct, image: null, reads: [], heads: [], queries: [], objects: new Map(), fail: false };
  const db = { async query(sql, args) {
    // The entire alias path is read-only, including failures and retries.
    assert.match(sql.trim(), /^SELECT\b/i);
    state.queries.push({ sql, args });
    if (sql.includes('FROM products p')) return { rows: state.product ? [{ ...state.product }] : [] };
    assert.match(sql, /WHERE pi\.product_id = \$1/);
    assert.match(sql, /ORDER BY pi\.priority, pi\.id/);
    assert.deepEqual(args, [Number(state.product.id)]);
    return { rows: state.image ? [{ ...state.image }] : [] };
  } };
  const storage = {
    async head(storageKey) {
      state.heads.push(storageKey);
      if (state.fail) throw new Error('R2 temporarily unavailable');
      return { ContentLength: state.objects.get(storageKey)?.length ?? 0 };
    },
    async read(storageKey) {
      state.reads.push(storageKey);
      if (state.fail) throw new Error('R2 temporarily unavailable');
      return state.objects.get(storageKey);
    },
  };
  const handler = createProductPlaceholderHandler({ db, storageFactory: () => storage, logger: { error() {} } });
  async function request(headers = {}, method = 'GET') {
    const res = response();
    await handler({ params: { article: selectedProduct?.article || product.article }, headers, method }, res);
    return res;
  }
  function publish(buffer, storageKey = key) {
    state.objects.set(storageKey, buffer);
    state.image = { id: 18, storage_key: storageKey, state: 'CURRENT', sha256: hash(buffer), byte_size: buffer.length };
  }
  return { state, db, storage, request, publish };
}

test('pilot is restricted to the selected article; old real-photo URLs are presented unchanged', () => {
  assert.equal(primaryImageAliasEnabled(product), true);
  assert.equal(primaryImageAliasEnabled({ article: 'А 451 323 03 40' }), true);
  for (const article of ['A1668307401', 'A1673340300', 'B66959846', '', 'A45132303400']) {
    assert.equal(primaryImageAliasEnabled({ article }), false);
  }
  const urls = ['https://cdn.example.test/old-image.webp', 'https://cdn.example.test/second.jpg'];
  for (const article of ['A4513230340', 'A1673340300']) {
    const result = ProductPlaceholderService.getProductImage({ article, imageUrls: urls });
    assert.equal(result.imageUrl, urls[0]);
    assert.deepEqual(result.imageUrls, urls);
    assert.equal(result.hasRealImage, true);
  }
});

test('non-pilot placeholders retain their existing bytes, ETag and cache policy; no photo storage is consulted', async () => {
  const oldProduct = { ...product, article: 'A1668307401', article_normalized: 'A1668307401' };
  const f = fixture(oldProduct);
  const expected = await ProductPlaceholderService.generatePlaceholder(oldProduct);
  const res = await f.request();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, expected.buffer);
  assert.equal(res.headers.etag, expected.etag);
  assert.equal(res.headers['cache-control'], 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  assert.equal(f.state.queries.length, 1);
  assert.deepEqual(f.state.heads, []);
  assert.deepEqual(f.state.reads, []);
});

test('same placeholder URL returns a placeholder, then the real bytes, then a newer photo without rewriting old objects', async () => {
  const f = fixture();
  const before = await f.request();
  assert.equal(before.statusCode, 200);
  assert.equal(before.headers['content-type'], 'image/webp');
  assert.equal(before.headers['cache-control'], 'public, no-cache, must-revalidate');
  assert.equal((await sharp(before.body).metadata()).width, 800);

  const first = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#d3d4d5' } }).webp().toBuffer();
  f.publish(first);
  const after = await f.request({ 'if-none-match': before.headers.etag });
  assert.equal(after.statusCode, 200);
  assert.deepEqual(after.body, first);
  assert.notEqual(after.headers.etag, before.headers.etag);
  assert.equal(after.headers.location, undefined);

  const second = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#121314' } }).webp().toBuffer();
  const secondKey = 'products/451/processed/second-photo.webp';
  f.publish(second, secondKey);
  const replacement = await f.request({ 'if-none-match': after.headers.etag });
  assert.equal(replacement.statusCode, 200);
  assert.deepEqual(replacement.body, second);
  assert.notEqual(replacement.headers.etag, after.headers.etag);
  assert.deepEqual(f.state.objects.get(key), first, 'the original R2 object is still byte-for-byte intact');
  assert.equal(ProductPlaceholderService.productPlaceholderUrl(product), '/api/products/A4513230340/placeholder');
});

test('real photo supports conditional GET with weak/list ETags and HEAD without a response body', async () => {
  const f = fixture();
  const body = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ededed' } }).webp().toBuffer();
  f.publish(body);
  const etag = `"${hash(body)}"`;
  for (const header of [etag, `W/${etag}`, `"obsolete", W/${etag}`, '*']) {
    const res = await f.request({ 'if-none-match': header, 'cache-control': 'no-cache' });
    assert.equal(res.statusCode, 304);
    assert.equal(res.headers.etag, etag);
    assert.equal(res.body, undefined);
    assert.equal(res.headers['cache-control'], 'public, no-cache, must-revalidate');
  }
  const head = await f.request({}, 'HEAD');
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers['content-length'], String(body.length));
  assert.equal(head.body, undefined);
});

test('placeholder conditional GET and HEAD use revalidation before the first photo is uploaded', async () => {
  const f = fixture();
  const first = await f.request();
  const notModified = await f.request({ 'if-none-match': first.headers.etag });
  assert.equal(notModified.statusCode, 304);
  assert.equal(notModified.headers['cache-control'], 'public, no-cache, must-revalidate');
  const head = await f.request({}, 'HEAD');
  assert.equal(head.headers['content-length'], String(first.body.length));
  assert.equal(head.body, undefined);
});

test('the selected ORIGINAL photo is served as PNG/JPEG without conversion or a forced WebP content type', async () => {
  for (const [format, extension, contentType] of [['png', 'png', 'image/png'], ['jpeg', 'jpg', 'image/jpeg']]) {
    const f = fixture();
    const body = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })[format]().toBuffer();
    f.publish(body, `products/451/originals/photo.${extension}`);
    // Newly uploaded originals may not yet have a hash recorded by the processor.
    f.state.image.sha256 = null;
    f.state.image.byte_size = null;
    const res = await f.request();
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], contentType);
    assert.deepEqual(res.body, body);
  }
});

test('a temporary R2 failure returns an uncacheable 503, never a stale placeholder/304; retry recovers', async () => {
  const f = fixture();
  const placeholder = await f.request();
  const body = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#999999' } }).webp().toBuffer();
  f.publish(body);
  f.state.fail = true;
  const unavailable = await f.request({ 'if-none-match': placeholder.headers.etag });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.headers['cache-control'], 'no-store');
  assert.equal(unavailable.headers['retry-after'], '60');
  assert.equal(unavailable.headers.etag, undefined);
  f.state.fail = false;
  assert.deepEqual((await f.request()).body, body);
});

test('after the last photo is removed, the same address returns the original placeholder with a changed ETag', async () => {
  const f = fixture();
  const before = await f.request();
  const body = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#222222' } }).webp().toBuffer();
  f.publish(body);
  const withPhoto = await f.request();
  f.state.image = null;
  const removed = await f.request({ 'if-none-match': withPhoto.headers.etag });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.body, before.body);
  assert.equal(removed.headers.etag, before.headers.etag);
  assert.deepEqual(f.state.objects.get(key), body);
});

test('unknown or inactive products return an uncacheable 404 and do not read storage', async () => {
  const f = fixture(null);
  const res = await f.request();
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(f.state.reads, []);
  assert.equal(f.state.queries.length, 1);
  assert.match(f.state.queries[0].sql, /p\.is_active = TRUE/);
});

test('another product key, traversal, external URL and unpublished objects are rejected before storage access', async () => {
  for (const [storageKey, state] of [
    ['products/999/processed/photo.webp', 'CURRENT'],
    ['products/451/processed/../originals/photo.webp', 'CURRENT'],
    ['https://untrusted.example.test/photo.webp', 'CURRENT'],
    ['products/451/merchant/photo.webp', 'CURRENT'],
    [key, 'STAGED'], [key, 'GARBAGE'], [key, null], ['', 'CURRENT'],
  ]) {
    const f = fixture();
    f.state.image = { storage_key: storageKey, state };
    const res = await f.request();
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(f.state.heads, []);
    assert.deepEqual(f.state.reads, []);
  }
});

test('corrupt bytes, size mismatch and unexpected content never become cacheable photo responses', async () => {
  const good = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).webp().toBuffer();
  for (const corrupt of ['checksum', 'size', 'content', 'oversize']) {
    const f = fixture();
    f.publish(good);
    if (corrupt === 'checksum') f.state.image.sha256 = '0'.repeat(64);
    if (corrupt === 'size') f.state.image.byte_size = good.length + 1;
    if (corrupt === 'content') f.publish(Buffer.from('<html>not an image</html>'));
    if (corrupt === 'oversize') f.storage.head = async () => ({ ContentLength: 33 * 1024 * 1024 });
    const res = await f.request();
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
});

test('non-pilot aliases cannot access DB or R2 even when called directly', async () => {
  assert.equal(await readPrimaryImageAlias({ article: 'A1673340300', id: 1 }, {
    query() { throw new Error('must not query'); },
  }, () => { throw new Error('must not read R2'); }), null);
});
