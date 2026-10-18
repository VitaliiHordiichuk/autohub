import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pool } from "../config/db.js";
import {
  IMAGE_BRANDING_MODE,
  IMAGE_PROCESSING_MODE,
  PROCESSED_IMAGE_SIZE,
  PRODUCT_IMAGE_PROCESSING_VERSION,
  ProductImageProcessor,
  isSmartProductImageProcessingEnabled,
  resolveImageBrandingMode,
  resolveImageProcessingMode,
} from "./ProductImageProcessor.js";
import { ProductPublicUpdateService } from "./ProductPublicUpdateService.js";
import { normalizeArticle } from "./articleEngine/normalize.js";
import { IMAGE_SLOTS, prepareVariant, publishObjects, rememberExisting, rememberOriginal, sha256, transaction, withImageLock } from './ProductImageLifecycle.js';

const mimeExtensions = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"],
]);
const activeJobs = new Set();
const PREVIEW_CONFIRMATION_TTL_MS = 30 * 60 * 1000;

function storageConfig() {
  const config = {
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    publicBaseUrl: String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  };
  if (Object.values(config).some((value) => !value)) {
    throw new Error("Cloudflare R2 ещё не настроен. Заполни R2-переменные в .env");
  }
  return config;
}

function client(config) {
  return new S3Client({ region: "auto", endpoint: config.endpoint,
    // Do not auto-add a second checksum: R2 uploads explicitly use Content-MD5.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
}

function positiveId(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`Некорректный ${label}`);
  return result;
}

function resolveSettingsAndDatabase(settings, database) {
  if (settings && typeof settings.query === "function") {
    return { settings: {}, db: settings };
  }
  if (typeof settings === "string") {
    return { settings: { brandingMode: settings }, db: database };
  }
  return { settings: settings && typeof settings === "object" ? settings : {}, db: database };
}

function parseCrop(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return parseCrop(JSON.parse(value));
    } catch {
      throw new Error("Некорректная область кадра");
    }
  }
  if (typeof value !== "object") throw new Error("Некорректная область кадра");
  const crop = {
    left: Number(value.left),
    top: Number(value.top),
    width: Number(value.width),
    height: Number(value.height),
  };
  if (Object.values(crop).some((coordinate) => !Number.isFinite(coordinate))
    || crop.left < 0 || crop.top < 0
    || crop.width < 0.02 || crop.height < 0.02
    || crop.left + crop.width > 1.000001
    || crop.top + crop.height > 1.000001) {
    throw new Error("Некорректная область кадра");
  }
  return crop;
}

function previewConfirmationSecret() {
  const secret = String(process.env.AUTH_JWT_SECRET || "");
  if (secret.length < 32) throw new Error("AUTH_JWT_SECRET отсутствует или короче 32 символов");
  return secret;
}

function encodePreviewToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", previewConfirmationSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function processingFingerprint(processing) {
  const sourceConfig = processing.processingConfig || {};
  const crop = sourceConfig.crop ?? processing.crop;
  const cropPaddingRatio = sourceConfig.cropPaddingRatio ?? processing.cropPaddingRatio;
  return createHash("sha256").update(JSON.stringify({
    processingMode: processing.processingMode,
    brandingMode: processing.brandingMode,
    processingConfig: {
      ...(crop ? { crop } : {}),
      ...(cropPaddingRatio !== undefined && cropPaddingRatio !== null ? { cropPaddingRatio } : {}),
    },
  })).digest("base64url");
}

function issuePreviewToken(payload) {
  return encodePreviewToken({ ...payload, expiresAt: Date.now() + PREVIEW_CONFIRMATION_TTL_MS });
}

function verifyPreviewToken(token, expected) {
  try {
    const [body, signature, extra] = String(token || "").split(".");
    if (!body || !signature || extra) throw new Error("invalid token");
    const expectedSignature = createHmac("sha256", previewConfirmationSecret())
      .update(body).digest("base64url");
    const supplied = Buffer.from(signature);
    const calculated = Buffer.from(expectedSignature);
    if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) {
      throw new Error("invalid signature");
    }
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now()) {
      throw new Error("expired token");
    }
    for (const [key, value] of Object.entries(expected)) {
      if (payload[key] !== value) throw new Error("mismatched token");
    }
  } catch {
    throw new Error("Сначала проверь и подтверди предварительный просмотр");
  }
}

function resolveProcessingSettings(settings, { requireSmartEnabled = true } = {}) {
  const processingMode = resolveImageProcessingMode(settings.processingMode);
  if (processingMode !== IMAGE_PROCESSING_MODE.LEGACY
    && requireSmartEnabled
    && !isSmartProductImageProcessingEnabled()) {
    throw new Error("Smart-обработка фотографий временно отключена");
  }
  const cropPaddingRatio = settings.cropPaddingRatio === undefined
    || settings.cropPaddingRatio === null || settings.cropPaddingRatio === ""
    ? undefined
    : Number(settings.cropPaddingRatio);
  const minimumCropPaddingRatio = processingMode === IMAGE_PROCESSING_MODE.PRODUCT_MAX ? 0.04 : 0.06;
  if (cropPaddingRatio !== undefined
    && (!Number.isFinite(cropPaddingRatio)
      || cropPaddingRatio < minimumCropPaddingRatio || cropPaddingRatio > 0.1)) {
    throw new Error(`Безопасное поле должно быть от ${minimumCropPaddingRatio * 100}% до 10%`);
  }
  const crop = parseCrop(settings.crop);
  if (processingMode === IMAGE_PROCESSING_MODE.PRODUCT_FOCUS && !crop) {
    throw new Error("Для PRODUCT_FOCUS выбери область кадра");
  }
  const brandingMode = resolveImageBrandingMode(
    processingMode === IMAGE_PROCESSING_MODE.LEGACY
      ? settings.brandingMode
      : settings.brandingMode ?? IMAGE_BRANDING_MODE.FULL_BRANDED,
  );
  return {
    processingMode,
    brandingMode,
    processingConfig: {
      ...(crop ? { crop } : {}),
      ...(cropPaddingRatio !== undefined ? { cropPaddingRatio } : {}),
    },
  };
}

async function bodyToBuffer(body) {
  if (!body) throw new Error("Пустой ответ хранилища");
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function publicUrl(config, key) {
  return `${config.publicBaseUrl}/${key}`;
}

export function createProductImageStorage() {
  const config = storageConfig();
  const r2 = client(config);
  return {
    async read(storageKey) {
      const source = await r2.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
      }));
      return bodyToBuffer(source.Body);
    },
    async uploadWebp(storageKey, body) {
      await r2.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
        Body: body,
        ContentType: "image/webp",
        ContentMD5: createHash('md5').update(body).digest('base64'),
        IfNoneMatch: '*',
        CacheControl: "public, max-age=31536000, immutable",
      }));
    },
    async verify(storageKey, body) {
      const head = await r2.send(new HeadObjectCommand({ Bucket: config.bucket, Key: storageKey }));
      // Our single-part PUTs have an MD5 ETag. Existing multipart objects are checked byte-for-byte.
      const expected = createHash('md5').update(body).digest('hex');
      if (Number(head.ContentLength) !== body.length) throw new Error('Stored image size mismatch');
      if (String(head.ETag || '').replaceAll('"', '') !== expected) {
        if (!(await this.read(storageKey)).equals(body)) throw new Error('Stored image checksum mismatch');
      }
    },
    async head(storageKey) {
      return r2.send(new HeadObjectCommand({ Bucket: config.bucket, Key: storageKey }));
    },
    async remove(storageKey) {
      await r2.send(new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
      }));
    },
    publicUrl(storageKey) {
      return publicUrl(config, storageKey);
    },
  };
}

function imageArticleSlug(article, productId) {
  return normalizeArticle(article).toLowerCase() || `product-${productId}`;
}

export function buildMerchantImageStorageKey({
  productId,
  imageId,
  article,
  revision = randomUUID(),
}) {
  const product = positiveId(productId, "productId");
  const image = positiveId(imageId, "imageId");
  const articleSlug = imageArticleSlug(article, product);
  return `products/${product}/merchant/${articleSlug}-photo-${image}-${revision}-clean-${PROCESSED_IMAGE_SIZE}.webp`;
}

async function buildSmartPreview(source, settings) {
  const requestedSettings = {
    ...settings,
    processingMode: settings?.processingMode || IMAGE_PROCESSING_MODE.PRODUCT_MAX,
  };
  const processing = resolveProcessingSettings(requestedSettings);
  if (processing.processingMode === IMAGE_PROCESSING_MODE.LEGACY) {
    throw new Error("Предпросмотр доступен только для PRODUCT MAX, SMART SAFE и PRODUCT FOCUS");
  }
  const processed = await ProductImageProcessor.process(source, {
    processingMode: processing.processingMode,
    brandingMode: processing.brandingMode,
    crop: processing.processingConfig.crop,
    cropPaddingRatio: processing.processingConfig.cropPaddingRatio,
  });
  return {
    preview: `data:image/webp;base64,${processed.variants[PROCESSED_IMAGE_SIZE].toString("base64")}`,
    metadata: processed.metadata,
    processing: {
      processingMode: processing.processingMode,
      brandingMode: processing.brandingMode,
      crop: processing.processingConfig.crop || null,
      cropPaddingRatio: processing.processingConfig.cropPaddingRatio ?? null,
    },
  };
}

export async function processProductImageRecord(imageId, db = pool, dependencies = {}) {
  const id = positiveId(imageId, "imageId");
  return withImageLock(db, id, async session => {
    const rowResult = await session.query(`SELECT pi.*,p.article
      FROM product_images pi
      JOIN products p ON p.id=pi.product_id
      WHERE pi.id=$1`, [id]);
    const row = rowResult.rows[0];
    if (!row?.original_storage_key) throw new Error("Оригинал изображения не найден");
    const storage = dependencies.storage || createProductImageStorage();
    const process = dependencies.process || ProductImageProcessor.process;
    await session.query("UPDATE product_images SET processing_status='PROCESSING',processing_error=NULL WHERE id=$1 AND processing_request_id=$2", [id, row.processing_request_id]);
    try {
      await rememberExisting(session, row, storage);
      const source = await storage.read(row.original_storage_key);
      await rememberOriginal(session, { key: row.original_storage_key, imageId: row.id,
        productId: row.product_id, body: source, url: row.original_url });
      const configuredMode = resolveImageProcessingMode(row.image_processing_mode);
      const effectiveMode = configuredMode !== IMAGE_PROCESSING_MODE.LEGACY
        && !isSmartProductImageProcessingEnabled()
        ? IMAGE_PROCESSING_MODE.LEGACY
        : configuredMode;
      const processingConfig = row.image_processing_config && typeof row.image_processing_config === "object"
        ? row.image_processing_config
        : {};
      const processed = await process(source, {
        brandingMode: row.image_branding_mode,
        processingMode: effectiveMode,
        crop: processingConfig.crop,
        cropPaddingRatio: processingConfig.cropPaddingRatio,
      });
      const variants = [];
      for (const slot of IMAGE_SLOTS) {
        variants.push(await prepareVariant(session, storage, row, slot,
          slot.role === 'merchant-1500' ? processed.merchant.variant : processed.variants[slot.size]));
      }
      return await transaction(session, async () => {
        const current = await session.query('SELECT processing_request_id FROM product_images WHERE id=$1 FOR UPDATE', [id]);
        if (String(current.rows[0]?.processing_request_id) !== String(row.processing_request_id)) return { superseded: true };
        await session.query(`UPDATE product_images SET
          processed_url_1600=$2,processed_url_1200=$3,processed_url_800=$4,processed_url_400=$5,
          processed_storage_key_1600=$6,processed_storage_key_1200=$7,
          processed_storage_key_800=$8,processed_storage_key_400=$9,
          original_width=$10,original_height=$11,processed_width=$12,processed_height=$13,
          image_quality_status=$14,merchant_url_1500=$15,merchant_storage_key_1500=$16,
          processing_version=$17,image_review_status=$18,image_review_reason=$19,
          processing_status='PROCESSED',display_mode='PROCESSED',processing_error=NULL,
          processed_at=CURRENT_TIMESTAMP,url=$2,storage_key=$6
          WHERE id=$1`, [id, ...variants.slice(0,4).map(item => item.url),
          ...variants.slice(0,4).map(item => item.key),
          processed.metadata.originalWidth, processed.metadata.originalHeight,
          processed.metadata.processedWidth, processed.metadata.processedHeight,
          processed.metadata.qualityStatus, variants[4].url, variants[4].key,
          processed.metadata.processingVersion || PRODUCT_IMAGE_PROCESSING_VERSION,
          processed.metadata.reviewStatus || "APPROVED", processed.metadata.reviewReason || null]);
        await publishObjects(session, row, variants);
        if (variants.some(item => !item.reused) || row.display_mode !== 'PROCESSED') {
          await ProductPublicUpdateService.touch(row.product_id, session);
        }
        return { processed: true, reused: variants.every(item => item.reused) };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Never delete in this catch: COMMIT/upload responses may be lost after succeeding.
      // Previous URLs, display mode, keys and Merchant image remain untouched on failure.
      await session.query(`UPDATE product_images SET processing_status='FAILED',processing_error=$2
        WHERE id=$1 AND processing_request_id=$3 AND processing_status='PROCESSING'`,
      [id, message.slice(0, 1000), row.processing_request_id]).catch(() => {});
      throw error;
    }
  });
}

export async function processMerchantImageRecord(imageId, db = pool, dependencies = {}) {
  return withImageLock(db, positiveId(imageId, 'imageId'), async session => {
    const result = await session.query('SELECT * FROM product_images WHERE id=$1', [imageId]);
    const row = result.rows[0];
    if (!row) return { skipped: 'missing_original' };
    if (row.merchant_url_1500 && row.merchant_storage_key_1500) return { skipped: 'already_has_merchant' };
    if (!row.original_storage_key) return { skipped: 'missing_original' };
    const storage = dependencies.storage || createProductImageStorage();
    let stage = 'original_not_accessible';
    try {
      await rememberExisting(session, row, storage);
      const original = await storage.read(row.original_storage_key);
      stage = 'processing_error';
      const merchant = await (dependencies.processMerchant || ProductImageProcessor.processMerchant)(original);
      stage = 'upload_error';
      const variant = await prepareVariant(session, storage, row, IMAGE_SLOTS[4], merchant.variant);
      stage = 'db_update_error';
      return await transaction(session, async () => {
        const updated = await session.query(`UPDATE product_images SET merchant_url_1500=$2,merchant_storage_key_1500=$3
          WHERE id=$1 AND (merchant_url_1500 IS NULL OR merchant_storage_key_1500 IS NULL) RETURNING id`,
        [imageId, variant.url, variant.key]);
        if (!updated.rows[0]) return { skipped: 'already_has_merchant' };
        await publishObjects(session, row, [variant]);
        await ProductPublicUpdateService.touch(row.product_id, session);
        return { processed: true };
      });
    } catch (error) { error.imageStage = stage; throw error; }
  });
}

function enqueue(imageId) {
  const id = Number(imageId);
  if (!id || activeJobs.has(id)) return;
  activeJobs.add(id);
  setImmediate(() => processProductImageRecord(id).catch((error) => {
    console.error(`Product image ${id} processing failed:`, error.message);
  }).finally(() => activeJobs.delete(id)));
}

export const ProductImageService = {
  capabilities() {
    const smartProcessing = isSmartProductImageProcessingEnabled();
    return {
      smartProcessing,
      preferredMode: smartProcessing ? IMAGE_PROCESSING_MODE.PRODUCT_MAX : IMAGE_PROCESSING_MODE.LEGACY,
      modes: [
        IMAGE_PROCESSING_MODE.PRODUCT_MAX,
        IMAGE_PROCESSING_MODE.SMART_SAFE,
        IMAGE_PROCESSING_MODE.PRODUCT_FOCUS,
      ],
    };
  },

  async searchProducts({search="",filter="ALL",productId=null,page=1,limit=50} = {}, db = pool) {
    const query = String(search).trim();
    const safeFilter=["ALL","WITH","WITHOUT"].includes(String(filter).toUpperCase())?String(filter).toUpperCase():"ALL";
    const safePage=Math.max(Number(page)||1,1);const safeLimit=Math.min(Math.max(Number(limit)||50,1),100);const offset=(safePage-1)*safeLimit;
    const conditions=[];const values=[];
    if(Number(productId)>0){values.push(Number(productId));conditions.push(`p.id=$${values.length}`);}
    if(query){values.push(`%${query}%`);conditions.push(`(p.article ILIKE $${values.length} OR p.name ILIKE $${values.length})`);}
    if(safeFilter==="WITH")conditions.push("EXISTS (SELECT 1 FROM product_images pi_filter WHERE pi_filter.product_id=p.id)");
    if(safeFilter==="WITHOUT")conditions.push("NOT EXISTS (SELECT 1 FROM product_images pi_filter WHERE pi_filter.product_id=p.id)");
    const where=conditions.length?`WHERE ${conditions.join(" AND ")}`:"";
    const count=await db.query(`SELECT COUNT(*)::integer AS total FROM products p ${where}`,values);
    values.push(safeLimit,offset);
    const result = await db.query(`
      SELECT p.id, p.article, p.name, b.name AS brand_name,
             (SELECT pi.url FROM product_images pi WHERE pi.product_id=p.id ORDER BY pi.priority,pi.id LIMIT 1) AS image_url,
             (SELECT COUNT(*)::integer FROM product_images pi WHERE pi.product_id=p.id) AS image_count
      FROM products p LEFT JOIN brands b ON b.id=p.brand_id
      ${where}
      ORDER BY ${query?`CASE WHEN p.article ILIKE $1 THEN 0 ELSE 1 END,`:""}p.article
      LIMIT $${values.length-1} OFFSET $${values.length}`, values);
    return {products:result.rows,pagination:{page:safePage,limit:safeLimit,total:Number(count.rows[0].total),pages:Math.max(1,Math.ceil(Number(count.rows[0].total)/safeLimit))}};
  },

  async list(productId, db = pool) {
    const result = await db.query(`SELECT id,product_id,url,source,priority,created_at,
      original_url,processed_url_1600,processed_url_1200,processed_url_800,processed_url_400,
      merchant_url_1500,
      processing_status,display_mode,processing_error,processed_at,
      original_width,original_height,processed_width,processed_height,image_quality_status,
      image_branding_mode,image_processing_mode,image_processing_config,
      image_review_status,image_review_reason
      FROM product_images WHERE product_id=$1 ORDER BY priority,id`, [positiveId(productId, "productId")]);
    return result.rows;
  },

  async history(productId, db = pool) {
    const product = positiveId(productId, "productId");
    const result = await db.query(`
      SELECT r.old_image_id, r.current_image_id, r.replaced_at,
             r.old_preview_url,
             r.old_snapshot->>'url' AS old_url,
             r.old_snapshot->>'original_url' AS original_url,
             r.old_snapshot->>'image_processing_mode' AS processing_mode,
             current.url AS current_url,
             objects.byte_size::bigint AS byte_size,
             COALESCE(objects.object_count, 0)::integer AS object_count
      FROM product_image_replacements r
      LEFT JOIN product_images current ON current.id=r.current_image_id
        AND current.product_id=r.product_id
      LEFT JOIN LATERAL (
        SELECT SUM(byte_size) AS byte_size, COUNT(*) AS object_count
        FROM product_image_objects
        WHERE image_id=r.old_image_id AND state <> 'DELETED'
      ) objects ON TRUE
      WHERE r.product_id=$1
      ORDER BY r.replaced_at DESC, r.old_image_id DESC
    `, [product]);
    return result.rows;
  },

  async replace(productId, oldImageId, newImageId, db = pool, dependencies = {}) {
    const product = positiveId(productId, 'productId');
    const oldId = positiveId(oldImageId, 'oldImageId');
    const nextId = positiveId(newImageId, 'newImageId');
    if (oldId === nextId) throw new Error('Нельзя заменить фотографию самой собой');
    // Lock both images in canonical order to prevent replacement, processing and deletion
    // from crossing between the preflight check and the committed replacement.
    const [first, second] = [oldId, nextId].sort((a, b) => a - b);
    const outcome = await withImageLock(db, first, async session =>
      withImageLock(session, second, async lockedSession =>
        transaction(lockedSession, async () => {
          const found = await lockedSession.query(
            `SELECT * FROM product_images
              WHERE product_id=$1 AND id=ANY($2::bigint[])
              ORDER BY id FOR UPDATE`, [product, [oldId, nextId]]);
          const oldPhoto = found.rows.find(row => Number(row.id) === oldId);
          const newPhoto = found.rows.find(row => Number(row.id) === nextId);
          if (!oldPhoto || !newPhoto) throw new Error('Обе фотографии должны принадлежать одному товару');
          if (oldPhoto.processing_status !== 'PROCESSED' || newPhoto.processing_status !== 'PROCESSED') {
            throw new Error('Сначала дождись завершения обработки обеих фотографий');
          }
          if (!newPhoto.url || !newPhoto.original_url || !newPhoto.original_storage_key
            || IMAGE_SLOTS.some(slot => !newPhoto[slot.key])) {
            throw new Error('Новая фотография должна иметь оригинал и все пять готовых версий');
          }
          const storage = dependencies.storage || createProductImageStorage();
          // The managed redirect needs a verified, published target even if the selected
          // destination photo was created before migration 108 (legacy direct R2 links).
          await rememberExisting(lockedSession, newPhoto, storage);
          for (const slot of IMAGE_SLOTS) {
            const key = newPhoto[slot.key];
            const bytes = await storage.read(key);
            if (!bytes.length) throw new Error('Один из файлов новой фотографии пуст');
            const actualHash = sha256(bytes);
            const updated = await lockedSession.query(`
              UPDATE product_image_objects SET sha256=$2,byte_size=$3
              WHERE storage_key=$1 AND (sha256 IS NULL OR sha256=$2)
              RETURNING storage_key`, [key, actualHash, bytes.length]);
            if (!updated.rows.length) throw new Error('Контрольная сумма файла новой фотографии не совпадает');
          }
          if (oldPhoto.original_storage_key || IMAGE_SLOTS.some(slot => oldPhoto[slot.key])) {
            await rememberExisting(lockedSession, oldPhoto, storage);
          }
          // Existing old aliases must follow the new active photo, including a chain A -> B -> C.
          await lockedSession.query(
            'UPDATE product_image_replacements SET current_image_id=$2 WHERE current_image_id=$1 AND product_id=$3',
            [oldId, nextId, product]);
          await lockedSession.query(`
            INSERT INTO product_image_replacements(
              old_image_id,product_id,current_image_id,old_snapshot,old_preview_url)
            VALUES($1,$2,$3,$4::jsonb,$5)`,
          [oldId, product, nextId, JSON.stringify(oldPhoto), oldPhoto.original_url || oldPhoto.url]);
          // The deleted source row automatically disappears from all public catalog/feed queries.
          // Keep durable alias metadata and raw R2 files until a separately approved purge.
          await lockedSession.query(
            "UPDATE product_image_objects SET state='RETIRED',delete_after=NULL WHERE image_id=$1 AND state='CURRENT' AND role<>'original'",
            [oldId]);
          await lockedSession.query('DELETE FROM product_images WHERE id=$1 AND product_id=$2', [oldId, product]);
          await lockedSession.query(
            'UPDATE product_images SET priority=LEAST(priority,$2) WHERE id=$1 AND product_id=$3',
            [nextId, oldPhoto.priority, product]);
          await ProductPublicUpdateService.touch(product, lockedSession);
          return { oldImageId: oldId, newImageId: nextId };
        })
      )
    );
    if (outcome?.busy) throw new Error('Фотография сейчас обрабатывается. Попробуй позже.');
    return outcome;
  },

  async upload(productId, files, settings, database = pool) {
    const request = resolveSettingsAndDatabase(settings, database);
    const db = request.db;
    const id = positiveId(productId, "productId");
    const processing = resolveProcessingSettings(request.settings);
    if (!files?.length) throw new Error("Выбери хотя бы одно изображение");
    if (processing.processingMode !== IMAGE_PROCESSING_MODE.LEGACY) {
      if (files.length !== 1) throw new Error("Подтверди каждое Smart-фото отдельно");
      verifyPreviewToken(request.settings.previewToken, {
        scope: "upload",
        productId: id,
        sourceFingerprint: createHash("sha256").update(files[0].buffer).digest("base64url"),
        processingFingerprint: processingFingerprint(processing),
      });
    }
    const exists = await db.query("SELECT article FROM products WHERE id=$1", [id]);
    if (!exists.rows[0]) throw new Error("Товар не найден");
    const articleSlug = imageArticleSlug(exists.rows[0].article, id);
    const config = storageConfig();
    const r2 = client(config);
    const storage = createProductImageStorage();
    const result = await withImageLock(db, `upload-${id}`, async session => {
      const current = await session.query("SELECT COALESCE(MAX(priority),-1)::integer AS priority FROM product_images WHERE product_id=$1", [id]);
      let priority = Number(current.rows[0].priority);
      const added = [];
      for (const file of files) {
        const extension = mimeExtensions.get(file.mimetype);
        if (!extension) throw new Error("Поддерживаются фотографии JPG, PNG и WEBP");
        const storageKey = `products/${id}/originals/${articleSlug}-photo-${randomUUID()}${extension}`;
        const url = publicUrl(config, storageKey);
        await rememberOriginal(session, { key: storageKey, productId: id, body: file.buffer, url, pending: true });
        await r2.send(new PutObjectCommand({ Bucket: config.bucket, Key: storageKey,
          Body: file.buffer, ContentType: file.mimetype, IfNoneMatch: '*',
          ContentMD5: createHash('md5').update(file.buffer).digest('base64'),
          CacheControl: "public, max-age=31536000, immutable" }));
        await storage.verify(storageKey, file.buffer);
        const result = await transaction(session, async () => {
          const inserted = await session.query(`INSERT INTO product_images(
            product_id,url,source,priority,storage_key,original_url,original_storage_key,
            processing_status,display_mode,image_branding_mode,image_processing_mode,
            image_processing_config,image_review_status,image_review_reason)
            VALUES($1,$2,'R2',$3,$4,$2,$4,'PROCESSING','ORIGINAL',$5,$6,$7,'APPROVED',NULL)
            RETURNING *`,
          [id, url, ++priority, storageKey, processing.brandingMode,
            processing.processingMode, JSON.stringify(processing.processingConfig)]);
          await rememberOriginal(session, { key: storageKey, productId: id, imageId: inserted.rows[0].id, url });
          await ProductPublicUpdateService.touch(id, session);
          return inserted;
        });
        added.push(result.rows[0]);
        enqueue(result.rows[0].id);
      }
      return added;
    });
    if (result?.busy) throw new Error('Завантаження фото цього товару вже виконується. Спробуй ще раз.');
    return result;
  },

  async previewUpload(productId, file, settings, db = pool) {
    const id = positiveId(productId, "productId");
    if (!file?.buffer || !mimeExtensions.has(file.mimetype)) {
      throw new Error("Поддерживаются фотографии JPG, PNG и WEBP");
    }
    const exists = await db.query("SELECT 1 FROM products WHERE id=$1", [id]);
    if (!exists.rows[0]) throw new Error("Товар не найден");
    const preview = await buildSmartPreview(file.buffer, settings);
    return {
      ...preview,
      previewToken: issuePreviewToken({
        scope: "upload",
        productId: id,
        sourceFingerprint: createHash("sha256").update(file.buffer).digest("base64url"),
        processingFingerprint: processingFingerprint(preview.processing),
      }),
    };
  },

  async previewExisting(productId, imageId, settings, db = pool) {
    const product = positiveId(productId, "productId");
    const image = positiveId(imageId, "imageId");
    const result = await db.query(`SELECT original_storage_key FROM product_images
      WHERE id=$1 AND product_id=$2`, [image, product]);
    const row = result.rows[0];
    if (!row?.original_storage_key) throw new Error("Оригинал изображения не найден");
    const source = await createProductImageStorage().read(row.original_storage_key);
    const preview = await buildSmartPreview(source, settings);
    return {
      ...preview,
      previewToken: issuePreviewToken({
        scope: "reprocess",
        productId: product,
        imageId: image,
        processingFingerprint: processingFingerprint(preview.processing),
      }),
    };
  },

  async makePrimary(productId, imageId, db = pool) {
    const product = positiveId(productId, "productId"); const image = positiveId(imageId, "imageId");
    const exists = await db.query("SELECT 1 FROM product_images WHERE id=$1 AND product_id=$2", [image, product]);
    if (!exists.rows[0]) throw new Error("Изображение не найдено");
    await db.query("UPDATE product_images SET priority=priority+1 WHERE product_id=$1", [product]);
    await db.query("UPDATE product_images SET priority=0 WHERE id=$1", [image]);
    await ProductPublicUpdateService.touch(product, db);
    return this.list(product, db);
  },

  async setDisplayMode(productId, imageId, mode, db = pool) {
    const product = positiveId(productId, "productId"); const image = positiveId(imageId, "imageId");
    const safeMode = String(mode).toUpperCase();
    if (!["ORIGINAL", "PROCESSED"].includes(safeMode)) throw new Error("Некорректный режим изображения");
    const result = await db.query(`UPDATE product_images SET display_mode=$3,
      processing_request_id=processing_request_id+1,
      processing_status=CASE WHEN processed_storage_key_1600 IS NOT NULL THEN 'PROCESSED' ELSE 'ORIGINAL_ONLY' END,
      url=CASE WHEN $3='PROCESSED' THEN processed_url_1600 ELSE original_url END,
      storage_key=CASE WHEN $3='PROCESSED' THEN processed_storage_key_1600 ELSE original_storage_key END
      WHERE id=$1 AND product_id=$2 AND ($3='ORIGINAL' OR processed_storage_key_1600 IS NOT NULL) RETURNING id`,
    [image, product, safeMode]);
    if (!result.rows[0]) throw new Error(safeMode === "PROCESSED" ? "Обработанная версия ещё не готова" : "Изображение не найдено");
    await ProductPublicUpdateService.touch(product, db);
    return this.list(product, db);
  },

  async reprocess(productId, imageId, settings, database = pool) {
    const request = resolveSettingsAndDatabase(settings, database);
    const db = request.db;
    const product = positiveId(productId, "productId"); const image = positiveId(imageId, "imageId");
    const processing = resolveProcessingSettings(request.settings);
    if (processing.processingMode !== IMAGE_PROCESSING_MODE.LEGACY) {
      verifyPreviewToken(request.settings.previewToken, {
        scope: "reprocess",
        productId: product,
        imageId: image,
        processingFingerprint: processingFingerprint(processing),
      });
    }
    const result = await db.query(`UPDATE product_images SET processing_status='PROCESSING',processing_error=NULL,
      processing_request_id=processing_request_id+1,
      image_branding_mode=$3,image_processing_mode=$4,image_processing_config=$5,
      image_review_status='APPROVED',image_review_reason=NULL
      WHERE id=$1 AND product_id=$2 RETURNING id`,
    [image, product, processing.brandingMode, processing.processingMode,
      JSON.stringify(processing.processingConfig)]);
    if (!result.rows[0]) throw new Error("Изображение не найдено");
    enqueue(image);
    return this.list(product, db);
  },

  async downloadProcessed(productId, imageUrl, db = pool) {
    const product = positiveId(productId, "productId");
    const requestedUrl = String(imageUrl || "").trim();
    if (!requestedUrl) throw new Error("Не вказано фото для завантаження");

    const result = await db.query(`SELECT p.article,pi.processed_storage_key_1600
      FROM product_images pi
      JOIN products p ON p.id=pi.product_id
      WHERE pi.product_id=$1
        AND (pi.url=$2 OR pi.original_url=$2 OR pi.processed_url_1600=$2
          OR pi.processed_url_1200=$2 OR pi.processed_url_800=$2 OR pi.processed_url_400=$2)
      ORDER BY pi.priority,pi.id LIMIT 1`, [product, requestedUrl]);
    const row = result.rows[0];
    if (!row) throw new Error("Фото товару не знайдено");
    if (!row.processed_storage_key_1600) throw new Error("Оброблене фото ще не готове");

    const config = storageConfig();
    const source = await client(config).send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: row.processed_storage_key_1600,
    }));
    const safeArticle = String(row.article || product)
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || String(product);

    return {
      buffer: await bodyToBuffer(source.Body),
      contentType: source.ContentType || "image/webp",
      fileName: `${safeArticle}-maka.webp`,
    };
  },

  async recoverPending(db = pool) {
    const result = await db.query(`SELECT id FROM product_images
      WHERE processing_status='PROCESSING' ORDER BY id LIMIT 20`);
    result.rows.forEach((row) => enqueue(row.id));
    return result.rows.length;
  },

  async remove(productId, imageId, db = pool) {
    const result = await withImageLock(db, positiveId(imageId, 'imageId'), async session => {
      return transaction(session, async () => {
        const found = await session.query(`SELECT * FROM product_images WHERE id=$1 AND product_id=$2 FOR UPDATE`,
          [positiveId(imageId, "imageId"), positiveId(productId, "productId")]);
        if (!found.rows[0]) throw new Error("Изображение не найдено");
        const record = found.rows[0];
        const aliases = await session.query(
          'SELECT 1 FROM product_image_replacements WHERE product_id=$1 AND current_image_id=$2 LIMIT 1',
          [positiveId(productId, "productId"), positiveId(imageId, "imageId")]);
        if (aliases.rows.length) {
          throw new Error('Эта фотография является заменой для старых ссылок. Сначала замени её другой фотографией.');
        }
        // URL-only/DB-only images have no R2 objects to register.
        // Avoid requiring storage credentials when deleting such records.
        if (record.original_storage_key || IMAGE_SLOTS.some(slot => record[slot.key])) {
          await rememberExisting(session, record, createProductImageStorage());
        }
        await session.query(`UPDATE product_image_objects SET state='RETIRED',delete_after=NOW()+INTERVAL '7 days'
          WHERE image_id=$1 AND role<>'original' AND state='CURRENT'`, [imageId]);
        await session.query("DELETE FROM product_images WHERE id=$1", [imageId]);
        await ProductPublicUpdateService.touch(productId, session);
      });
    });
    if (result?.busy) throw new Error('Фото ще обробляється. Спробуй видалити його пізніше.');
  },
};
