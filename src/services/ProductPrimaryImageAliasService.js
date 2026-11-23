import { createHash } from 'node:crypto';
import { normalizeArticle } from './articleEngine/normalize.js';

// Pilot only: these products had no real photos when its placeholder URL was recorded.
// Expanding the pilot must never rewrite product_images URLs or existing R2 objects.
const PILOT_ARTICLES = new Set(['A4513230340', 'A2975400441']);
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export function primaryImageAliasEnabled(product) {
  return PILOT_ARTICLES.has(normalizeArticle(product?.article_normalized || product?.article));
}

function imageContentType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Unsupported stored product image');
}

export async function readPrimaryImageAlias(product, db, storageFactory) {
  if (!primaryImageAliasEnabled(product)) return null;
  const productId = Number(product.id);
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('Invalid product id');
  // Use the same priority/id order and selected display object as the storefront.
  // Never fetch a URL supplied by a request or fall through to another product's photo.
  const result = await db.query(`SELECT pi.id, pi.storage_key, obj.state, obj.sha256, obj.byte_size
    FROM product_images pi
    LEFT JOIN product_image_objects obj ON obj.storage_key = pi.storage_key
    WHERE pi.product_id = $1
    ORDER BY pi.priority, pi.id
    LIMIT 1`, [productId]);
  const image = result.rows[0];
  if (!image) return null;
  const key = String(image.storage_key || '');
  if (!key.startsWith(`products/${productId}/`)
      || !/^products\/\d+\/(originals|processed)\/[a-zA-Z0-9._/-]+\.(webp|png|jpe?g)$/.test(key)
      || key.split('/').some(part => part === '.' || part === '..')
      || image.state !== 'CURRENT') {
    throw new Error('Primary product image is not a trusted current object');
  }

  const storage = storageFactory();
  const head = await storage.head(key);
  const size = Number(head.ContentLength);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES
      || (image.byte_size != null && size !== Number(image.byte_size))) {
    throw new Error('Stored product image size mismatch');
  }
  const buffer = await storage.read(key);
  if (!Buffer.isBuffer(buffer) || buffer.length !== size) throw new Error('Stored product image size mismatch');
  const hash = createHash('sha256').update(buffer).digest('hex');
  if (image.sha256 && hash !== image.sha256) throw new Error('Stored product image checksum mismatch');
  return { buffer, contentType: imageContentType(buffer), etag: `"${hash}"` };
}
