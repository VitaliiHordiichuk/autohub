import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
  const brandingMode = processingMode === IMAGE_PROCESSING_MODE.LEGACY
    ? resolveImageBrandingMode(settings.brandingMode)
    : IMAGE_BRANDING_MODE.CLEAN;
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
        CacheControl: "public, max-age=31536000, immutable",
      }));
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
    brandingMode: IMAGE_BRANDING_MODE.CLEAN,
    crop: processing.processingConfig.crop,
    cropPaddingRatio: processing.processingConfig.cropPaddingRatio,
  });
  return {
    preview: `data:image/webp;base64,${processed.variants[PROCESSED_IMAGE_SIZE].toString("base64")}`,
    metadata: processed.metadata,
    processing: {
      processingMode: processing.processingMode,
      crop: processing.processingConfig.crop || null,
      cropPaddingRatio: processing.processingConfig.cropPaddingRatio ?? null,
    },
  };
}

async function removeKeys(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return;
  const config = storageConfig();
  const r2 = client(config);
  await Promise.all(unique.map((key) => r2.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })).catch(() => {})));
}

export async function processProductImageRecord(imageId, db = pool) {
  const id = positiveId(imageId, "imageId");
  const rowResult = await db.query(`SELECT pi.id,pi.product_id,pi.url,pi.original_url,pi.display_mode,pi.original_storage_key,
      pi.processed_storage_key_1600,pi.processed_storage_key_1200,
      pi.processed_storage_key_800,pi.processed_storage_key_400,
      pi.merchant_storage_key_1500,
      pi.image_branding_mode,pi.image_processing_mode,pi.image_processing_config,p.article
    FROM product_images pi
    JOIN products p ON p.id=pi.product_id
    WHERE pi.id=$1`, [id]);
  const row = rowResult.rows[0];
  if (!row?.original_storage_key) throw new Error("Оригинал изображения не найден");
  await db.query("UPDATE product_images SET processing_status='PROCESSING',processing_error=NULL WHERE id=$1", [id]);
  const config = storageConfig();
  const r2 = client(config);
  const uploadedKeys = [];
  try {
    const source = await r2.send(new GetObjectCommand({ Bucket: config.bucket, Key: row.original_storage_key }));
    const configuredMode = resolveImageProcessingMode(row.image_processing_mode);
    const effectiveMode = configuredMode !== IMAGE_PROCESSING_MODE.LEGACY
      && !isSmartProductImageProcessingEnabled()
      ? IMAGE_PROCESSING_MODE.LEGACY
      : configuredMode;
    const processingConfig = row.image_processing_config && typeof row.image_processing_config === "object"
      ? row.image_processing_config
      : {};
    const processed = await ProductImageProcessor.process(await bodyToBuffer(source.Body), {
      brandingMode: row.image_branding_mode,
      processingMode: effectiveMode,
      crop: processingConfig.crop,
      cropPaddingRatio: processingConfig.cropPaddingRatio,
    });
    const revision = randomUUID();
    const articleSlug = imageArticleSlug(row.article, row.product_id);
    const keys = {};
    const variantSlots = [
      { slot: 1600, outputSize: PROCESSED_IMAGE_SIZE },
      { slot: 1200, outputSize: 1200 },
      { slot: 800, outputSize: 800 },
      { slot: 400, outputSize: 400 },
    ];
    for (const { slot, outputSize } of variantSlots) {
      const key = `products/${row.product_id}/processed/${articleSlug}-photo-${id}-${revision}-${outputSize}.webp`;
      await r2.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: processed.variants[outputSize],
        ContentType: "image/webp", CacheControl: "public, max-age=31536000, immutable" }));
      keys[slot] = key;
      uploadedKeys.push(key);
    }
    const merchantKey = buildMerchantImageStorageKey({
      productId: row.product_id,
      imageId: id,
      article: row.article,
      revision,
    });
    await r2.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: merchantKey,
      Body: processed.merchant.variant,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    }));
    uploadedKeys.push(merchantKey);
    const oldKeys = [row.processed_storage_key_1600, row.processed_storage_key_1200,
      row.processed_storage_key_800, row.processed_storage_key_400,
      row.merchant_storage_key_1500];
    await db.query(`UPDATE product_images SET
      processed_url_1600=$2,processed_url_1200=$3,processed_url_800=$4,processed_url_400=$5,
      processed_storage_key_1600=$6,processed_storage_key_1200=$7,
      processed_storage_key_800=$8,processed_storage_key_400=$9,
      original_width=$10,original_height=$11,processed_width=$12,processed_height=$13,
      image_quality_status=$14,merchant_url_1500=$15,merchant_storage_key_1500=$16,
      processing_version=$17,image_review_status=$18,image_review_reason=$19,
      processing_status='PROCESSED',display_mode='PROCESSED',processing_error=NULL,
      processed_at=CURRENT_TIMESTAMP,url=$2,storage_key=$6
      WHERE id=$1`, [id, publicUrl(config, keys[1600]), publicUrl(config, keys[1200]),
      publicUrl(config, keys[800]), publicUrl(config, keys[400]),
      keys[1600], keys[1200], keys[800], keys[400],
      processed.metadata.originalWidth, processed.metadata.originalHeight,
      processed.metadata.processedWidth, processed.metadata.processedHeight,
      processed.metadata.qualityStatus, publicUrl(config, merchantKey), merchantKey,
      processed.metadata.processingVersion || PRODUCT_IMAGE_PROCESSING_VERSION,
      processed.metadata.reviewStatus || "APPROVED", processed.metadata.reviewReason || null]);
    await ProductPublicUpdateService.touch(row.product_id, db);
    await removeKeys(oldKeys);
  } catch (error) {
    await removeKeys(uploadedKeys);
    const message = error instanceof Error ? error.message : String(error);
    await db.query(`UPDATE product_images SET processing_status='FAILED',processing_error=$2,
      display_mode='ORIGINAL',url=original_url,storage_key=original_storage_key WHERE id=$1`, [id, message.slice(0, 1000)]);
    if (row.display_mode !== "ORIGINAL" || row.url !== row.original_url) {
      await ProductPublicUpdateService.touch(row.product_id, db);
    }
    throw error;
  }
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
    const current = await db.query("SELECT COALESCE(MAX(priority),-1)::integer AS priority FROM product_images WHERE product_id=$1", [id]);
    let priority = Number(current.rows[0].priority);
    const added = [];
    for (const file of files) {
      const extension = mimeExtensions.get(file.mimetype);
      if (!extension) throw new Error("Поддерживаются фотографии JPG, PNG и WEBP");
      const storageKey = `products/${id}/originals/${articleSlug}-photo-${randomUUID()}${extension}`;
      await r2.send(new PutObjectCommand({ Bucket: config.bucket, Key: storageKey,
        Body: file.buffer, ContentType: file.mimetype, CacheControl: "public, max-age=31536000, immutable" }));
      const url = publicUrl(config, storageKey);
      let result;
      try {
        result = await db.query(`INSERT INTO product_images(
          product_id,url,source,priority,storage_key,original_url,original_storage_key,
          processing_status,display_mode,image_branding_mode,image_processing_mode,
          image_processing_config,image_review_status,image_review_reason)
          VALUES($1,$2,'R2',$3,$4,$2,$4,'PROCESSING','ORIGINAL',$5,$6,$7,'APPROVED',NULL)
          RETURNING *`,
        [id, url, ++priority, storageKey, processing.brandingMode,
          processing.processingMode, JSON.stringify(processing.processingConfig)]);
      } catch (error) {
        await r2.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey })).catch(() => {});
        throw error;
      }
      added.push(result.rows[0]);
      enqueue(result.rows[0].id);
    }
    if (added.length) await ProductPublicUpdateService.touch(id, db);
    return added;
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
      url=CASE WHEN $3='PROCESSED' THEN processed_url_1600 ELSE original_url END,
      storage_key=CASE WHEN $3='PROCESSED' THEN processed_storage_key_1600 ELSE original_storage_key END
      WHERE id=$1 AND product_id=$2 AND ($3='ORIGINAL' OR processing_status='PROCESSED') RETURNING id`,
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
    const result = await db.query(`SELECT storage_key,original_storage_key,processed_storage_key_1600,
      processed_storage_key_1200,processed_storage_key_800,processed_storage_key_400,
      merchant_storage_key_1500
      FROM product_images WHERE id=$1 AND product_id=$2`,
      [positiveId(imageId, "imageId"), positiveId(productId, "productId")]);
    if (!result.rows[0]) throw new Error("Изображение не найдено");
    const row = result.rows[0];
    await removeKeys([row.storage_key,row.original_storage_key,row.processed_storage_key_1600,
      row.processed_storage_key_1200,row.processed_storage_key_800,row.processed_storage_key_400,
      row.merchant_storage_key_1500]);
    await db.query("DELETE FROM product_images WHERE id=$1", [positiveId(imageId, "imageId")]);
    await ProductPublicUpdateService.touch(productId, db);
  },
};
