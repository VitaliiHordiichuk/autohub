import { createHash } from 'node:crypto';

export const IMAGE_SLOTS = Object.freeze([
  { role: 'site-1500', size: 1500, key: 'processed_storage_key_1600', url: 'processed_url_1600' },
  { role: 'site-1200', size: 1200, key: 'processed_storage_key_1200', url: 'processed_url_1200' },
  { role: 'site-800', size: 800, key: 'processed_storage_key_800', url: 'processed_url_800' },
  { role: 'site-400', size: 400, key: 'processed_storage_key_400', url: 'processed_url_400' },
  { role: 'merchant-1500', size: 1500, key: 'merchant_storage_key_1500', url: 'merchant_url_1500' },
]);
export const sha256 = body => createHash('sha256').update(body).digest('hex');
export const isMissingObject = error => error?.$metadata?.httpStatusCode === 404 || ['NoSuchKey','NotFound'].includes(error?.name);

export function deliveryBase() {
  const value = String(process.env.PRODUCT_IMAGE_DELIVERY_BASE_URL || '').replace(/\/+$/, '');
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/api/product-media' || url.hostname.endsWith('.r2.dev')) {
    throw new Error('PRODUCT_IMAGE_DELIVERY_BASE_URL must be an HTTPS /api/product-media URL on a controlled domain');
  }
  return value;
}

export function managedImageUrl(imageId, role, hash, base = deliveryBase()) {
  return base ? `${base}/${imageId}/${role}/${hash}.webp` : null;
}

// A dedicated session serializes workers, GC and explicit image deletion across processes.
// Request generation CAS below still allows a newer admin request to supersede a slow worker.
export async function withImageLock(db, id, work) {
  const session = typeof db.connect === 'function' && !db.connection ? await db.connect() : db;
  let locked = false;
  let broken;
  try {
    const result = await session.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [`product-image:${id}`]);
    locked = result.rows[0]?.locked === true;
    if (!locked) return { busy: true };
    return await work(session);
  } finally {
    if (locked) {
      try { await session.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`product-image:${id}`]); }
      catch (error) { broken = error; }
    }
    if (session !== db) session.release(broken);
  }
}

export async function transaction(db, work) {
  await db.query('BEGIN');
  try { const result = await work(); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
}

export async function rememberOriginal(db, { key, imageId = null, productId, body, url, pending = false }) {
  await db.query(`INSERT INTO product_image_objects(storage_key,image_id,product_id,role,sha256,byte_size,state,public_url,legacy_public)
    VALUES($1,$2,$3,'original',$4,$5,$7,$6,TRUE)
    ON CONFLICT(storage_key) DO UPDATE SET image_id=COALESCE(product_image_objects.image_id,EXCLUDED.image_id),
      sha256=COALESCE(product_image_objects.sha256,EXCLUDED.sha256),byte_size=COALESCE(product_image_objects.byte_size,EXCLUDED.byte_size),
      state=CASE WHEN EXCLUDED.state='CURRENT' THEN 'CURRENT' ELSE product_image_objects.state END`,
  [key, imageId, productId, body ? sha256(body) : null, body?.length ?? null, url, pending ? 'STAGED' : 'CURRENT']);
}

export async function rememberExisting(db, row, storage) {
  if (row.original_storage_key) await rememberOriginal(db, {
    key: row.original_storage_key, imageId: row.id, productId: row.product_id,
    url: row.original_url || storage.publicUrl(row.original_storage_key),
  });
  for (const slot of IMAGE_SLOTS) {
    if (!row[slot.key]) continue;
    // Untracked, already published keys are conservatively protected, regardless of hostname.
    await db.query(`INSERT INTO product_image_objects(storage_key,image_id,product_id,role,state,public_url,legacy_public,published_at)
      VALUES($1,$2,$3,$4,'CURRENT',$5,TRUE,NOW()) ON CONFLICT(storage_key) DO NOTHING`,
    [row[slot.key], row.id, row.product_id, slot.role, row[slot.url] || storage.publicUrl(row[slot.key])]);
  }
}

export async function prepareVariant(db, storage, row, slot, body) {
  if (!Buffer.isBuffer(body) || !body.length) throw new Error('Empty image derivative');
  const hash = sha256(body);
  const previousKey = row[slot.key];
  if (previousKey) {
    // One-time byte comparison also deduplicates pre-migration UUID objects without changing URLs.
    const known = await db.query('SELECT sha256,byte_size FROM product_image_objects WHERE storage_key=$1', [previousKey]);
    let equal = known.rows[0]?.sha256 === hash;
    if (!known.rows[0]?.sha256) {
      try { equal = sha256(await storage.read(previousKey)) === hash; }
      catch (error) { if (!isMissingObject(error)) throw error; }
    }
    if (equal) {
      try {
        await storage.verify(previousKey, body);
        await db.query('UPDATE product_image_objects SET sha256=$2,byte_size=$3 WHERE storage_key=$1', [previousKey, hash, body.length]);
        return { ...slot, key: previousKey, url: row[slot.url] || storage.publicUrl(previousKey), hash, reused: true };
      } catch (error) { if (!isMissingObject(error)) throw error; }
    }
  }
  const directory = slot.role.startsWith('merchant') ? 'merchant' : 'processed';
  const key = `products/${row.product_id}/${directory}/photo-${row.id}-${hash}-${slot.role}.webp`;
  const url = managedImageUrl(row.id, slot.role, hash) || storage.publicUrl(key);
  // Durable intent precedes R2 PUT: even an ambiguous upload failure is accounted for.
  await db.query(`INSERT INTO product_image_objects(storage_key,image_id,product_id,role,sha256,byte_size,state,public_url,delete_after)
    VALUES($1,$2,$3,$4,$5,$6,'STAGED',$7,NOW()+INTERVAL '7 days')
    ON CONFLICT(storage_key) DO UPDATE SET
      state=CASE WHEN product_image_objects.state='CURRENT' THEN 'CURRENT' ELSE 'STAGED' END,
      delete_after=NOW()+INTERVAL '7 days',last_error=NULL`,
  [key, row.id, row.product_id, slot.role, hash, body.length, url]);
  try { await storage.verify(key, body); }
  catch (error) {
    if (!isMissingObject(error)) throw error;
    await storage.uploadWebp(key, body);
    await storage.verify(key, body);
  }
  return { ...slot, key, url, hash, reused: false };
}

export async function publishObjects(db, row, variants) {
  const keys = variants.map(item => item.key);
  const roles = variants.map(item => item.role);
  await db.query(`UPDATE product_image_objects SET state='RETIRED',delete_after=NOW()+INTERVAL '7 days'
    WHERE image_id=$1 AND role=ANY($3::text[]) AND state='CURRENT' AND NOT(storage_key=ANY($2::text[]))`, [row.id, keys, roles]);
  for (const item of variants) {
    const controlled = /\/api\/product-media\/\d+\/(site|merchant)-\d+\/[a-f0-9]{64}\.webp$/.test(item.url);
    await db.query(`UPDATE product_image_objects SET state='CURRENT',published_at=COALESCE(published_at,NOW()),
      public_url=$2,legacy_public=legacy_public OR $3,delete_after=NULL,last_error=NULL WHERE storage_key=$1`,
    [item.key, item.url, !controlled]);
  }
}

// Keep all published alias metadata, including deleted physical versions, for old managed URLs.
export async function resolvePublishedImage(db, imageId, role, hash) {
  const slot = IMAGE_SLOTS.find(item => item.role === role);
  if (!slot || !/^[1-9]\d{0,14}$/.test(String(imageId)) || !/^[a-f0-9]{64}$/.test(hash)) return null;
  const result = await db.query(`SELECT current.storage_key,current.sha256,current.byte_size,current.public_url
    FROM product_image_objects old
    JOIN product_images image ON image.id=old.image_id
    JOIN product_image_objects current ON current.storage_key=image.${slot.key}
    WHERE old.image_id=$1 AND old.role=$2 AND old.sha256=$3 AND old.published_at IS NOT NULL
      AND current.state='CURRENT' AND current.published_at IS NOT NULL LIMIT 1`, [imageId, role, hash]);
  if (result.rows[0]) return { ...result.rows[0], current_image_id: Number(imageId) };

  // An explicitly replaced source no longer has a product_images row. Resolve only
  // registered, actually published managed aliases from the durable history table.
  // current_image_id is always an active image; chained replacements are flattened.
  const archived = await db.query(`SELECT current.storage_key,current.sha256,current.byte_size,
      current.public_url,history.current_image_id
    FROM product_image_objects old
    JOIN product_image_replacements history ON history.old_image_id=old.image_id
    JOIN product_images image ON image.id=history.current_image_id
      AND image.product_id=history.product_id
    JOIN product_image_objects current ON current.storage_key=image.${slot.key}
    WHERE old.image_id=$1 AND old.role=$2 AND old.sha256=$3
      AND old.published_at IS NOT NULL
      AND current.state='CURRENT' AND current.published_at IS NOT NULL
    LIMIT 1`, [imageId, role, hash]);
  return archived.rows[0] || null;
}
