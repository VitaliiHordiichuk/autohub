import { pool } from '../config/db.js';
import { createProductImageStorage } from './ProductImageService.js';
import { IMAGE_SLOTS, withImageLock } from './ProductImageLifecycle.js';

export async function collectProductImageGarbage({ apply = false, limit = 20 } = {}, dependencies = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('GC limit must be 1..100');
  if (apply && process.env.PRODUCT_IMAGE_GC_ENABLED !== 'true') throw new Error('Image GC is disabled');
  const db = dependencies.db || pool;
  let storage = dependencies.storage;
  const verifiedSets = new Set();
  const candidates = await db.query(`SELECT * FROM product_image_objects
    WHERE state IN ('STAGED','RETIRED','DELETING') AND role<>'original' AND NOT legacy_public
      AND delete_after <= NOW() ORDER BY delete_after,storage_key LIMIT $1`, [limit]);
  const results = [];
  for (const candidate of candidates.rows) {
    const outcome = await withImageLock(db, candidate.image_id, async session => {
      const fresh = await session.query(`SELECT * FROM product_image_objects WHERE storage_key=$1
        AND state IN ('STAGED','RETIRED','DELETING') AND role<>'original' AND NOT legacy_public
        AND delete_after<=NOW()`, [candidate.storage_key]);
      const row = fresh.rows[0];
      if (!row) return 'protected';
      // Only our derived namespace, never a guessed prefix or an original supplied as a candidate.
      const directory = row.role.startsWith('merchant') ? 'merchant' : 'processed';
      const expectedKey = `products/${row.product_id}/${directory}/photo-${row.image_id}-${row.sha256}-${row.role}.webp`;
      if (!row.sha256 || row.storage_key !== expectedKey) return 'unmanaged';
      // These are the image sources for storefront, SEO, Merchant and homepage. Also protect
      // raw-key URLs pasted into product descriptions/banner content. Managed aliases need no bytes.
      const references = await session.query(`SELECT
        EXISTS(SELECT 1 FROM product_images p WHERE strpos(row_to_json(p)::text,$1)>0)
        OR EXISTS(SELECT 1 FROM homepage_banners b WHERE strpos(row_to_json(b)::text,$1)>0)
        OR EXISTS(SELECT 1 FROM product_translations t WHERE strpos(row_to_json(t)::text,$1)>0)
        OR EXISTS(SELECT 1 FROM customer_category_translations c WHERE strpos(row_to_json(c)::text,$1)>0)
        OR EXISTS(SELECT 1 FROM products p WHERE strpos(row_to_json(p)::text,$1)>0) AS referenced`, [row.storage_key]);
      if (references.rows[0]?.referenced !== false) {
        if (apply) await session.query("UPDATE product_image_objects SET delete_after=NOW()+INTERVAL '1 day' WHERE storage_key=$1", [row.storage_key]);
        return 'referenced';
      }
      if (!apply) return 'eligible';
      storage ||= createProductImageStorage();
      try {
        // Don't discard a fallback if the replacement set has become unavailable.
        const current = await session.query('SELECT * FROM product_images WHERE id=$1', [row.image_id]);
        if (current.rows[0]?.processing_status === 'PROCESSING') return 'processing';
        if (current.rows[0]) {
          const currentKeys = IMAGE_SLOTS.map(slot => current.rows[0][slot.key]).filter(Boolean);
          const signature = JSON.stringify(currentKeys);
          if (!verifiedSets.has(signature)) {
            for (const key of currentKeys) {
              const head = await storage.head(key);
              if (!(Number(head.ContentLength) > 0)) throw new Error('Replacement image is empty');
            }
            verifiedSets.add(signature);
          }
        }
        await session.query(`UPDATE product_image_objects SET state='DELETING',delete_attempts=delete_attempts+1,
          last_error=NULL WHERE storage_key=$1`, [row.storage_key]);
        await storage.remove(row.storage_key); // S3 DELETE is idempotent, including an already absent key.
        await session.query(`UPDATE product_image_objects SET state='DELETED',delete_after=NULL,last_error=NULL
          WHERE storage_key=$1`, [row.storage_key]);
        return 'deleted';
      } catch (error) {
        // Keep the tombstone even when DELETE succeeded but its response/DB acknowledgement failed.
        await session.query(`UPDATE product_image_objects SET last_error=$2,delete_after=NOW()+INTERVAL '1 hour'
          WHERE storage_key=$1`, [row.storage_key, String(error.message || error).slice(0,1000)]);
        return 'retry';
      }
    });
    results.push({ key: candidate.storage_key, result: outcome?.busy ? 'busy' : outcome });
  }
  return { apply, scanned: candidates.rows.length, results };
}
