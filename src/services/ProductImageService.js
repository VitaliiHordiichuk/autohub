import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pool } from "../config/db.js";
import { ProductImageProcessor } from "./ProductImageProcessor.js";
import { normalizeArticle } from "./articleEngine/normalize.js";

const mimeExtensions = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"],
]);
const activeJobs = new Set();

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

function imageArticleSlug(article, productId) {
  return normalizeArticle(article).toLowerCase() || `product-${productId}`;
}

async function removeKeys(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return;
  const config = storageConfig();
  const r2 = client(config);
  await Promise.all(unique.map((key) => r2.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })).catch(() => {})));
}

async function runProcessing(imageId, db = pool) {
  const id = positiveId(imageId, "imageId");
  const rowResult = await db.query(`SELECT pi.id,pi.product_id,pi.original_storage_key,
      pi.processed_storage_key_1600,pi.processed_storage_key_1200,
      pi.processed_storage_key_800,pi.processed_storage_key_400,p.article
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
    const variants = await ProductImageProcessor.process(await bodyToBuffer(source.Body));
    const revision = randomUUID();
    const articleSlug = imageArticleSlug(row.article, row.product_id);
    const keys = {};
    for (const size of [1600, 1200, 800, 400]) {
      const key = `products/${row.product_id}/processed/${articleSlug}-photo-${id}-${revision}-${size}.webp`;
      await r2.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: variants[size],
        ContentType: "image/webp", CacheControl: "public, max-age=31536000, immutable" }));
      keys[size] = key;
      uploadedKeys.push(key);
    }
    const oldKeys = [row.processed_storage_key_1600, row.processed_storage_key_1200,
      row.processed_storage_key_800, row.processed_storage_key_400];
    await db.query(`UPDATE product_images SET
      processed_url_1600=$2,processed_url_1200=$3,processed_url_800=$4,processed_url_400=$5,
      processed_storage_key_1600=$6,processed_storage_key_1200=$7,
      processed_storage_key_800=$8,processed_storage_key_400=$9,
      processing_status='PROCESSED',display_mode='PROCESSED',processing_error=NULL,
      processed_at=CURRENT_TIMESTAMP,url=$2,storage_key=$6
      WHERE id=$1`, [id, publicUrl(config, keys[1600]), publicUrl(config, keys[1200]),
      publicUrl(config, keys[800]), publicUrl(config, keys[400]),
      keys[1600], keys[1200], keys[800], keys[400]]);
    await removeKeys(oldKeys);
  } catch (error) {
    await removeKeys(uploadedKeys);
    const message = error instanceof Error ? error.message : String(error);
    await db.query(`UPDATE product_images SET processing_status='FAILED',processing_error=$2,
      display_mode='ORIGINAL',url=original_url,storage_key=original_storage_key WHERE id=$1`, [id, message.slice(0, 1000)]);
    throw error;
  }
}

function enqueue(imageId) {
  const id = Number(imageId);
  if (!id || activeJobs.has(id)) return;
  activeJobs.add(id);
  setImmediate(() => runProcessing(id).catch((error) => {
    console.error(`Product image ${id} processing failed:`, error.message);
  }).finally(() => activeJobs.delete(id)));
}

export const ProductImageService = {
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
      processing_status,display_mode,processing_error,processed_at
      FROM product_images WHERE product_id=$1 ORDER BY priority,id`, [positiveId(productId, "productId")]);
    return result.rows;
  },

  async upload(productId, files, db = pool) {
    const id = positiveId(productId, "productId");
    if (!files?.length) throw new Error("Выбери хотя бы одно изображение");
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
          product_id,url,source,priority,storage_key,original_url,original_storage_key,processing_status,display_mode)
          VALUES($1,$2,'R2',$3,$4,$2,$4,'PROCESSING','ORIGINAL') RETURNING *`, [id, url, ++priority, storageKey]);
      } catch (error) {
        await r2.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey })).catch(() => {});
        throw error;
      }
      added.push(result.rows[0]);
      enqueue(result.rows[0].id);
    }
    return added;
  },

  async makePrimary(productId, imageId, db = pool) {
    const product = positiveId(productId, "productId"); const image = positiveId(imageId, "imageId");
    const exists = await db.query("SELECT 1 FROM product_images WHERE id=$1 AND product_id=$2", [image, product]);
    if (!exists.rows[0]) throw new Error("Изображение не найдено");
    await db.query("UPDATE product_images SET priority=priority+1 WHERE product_id=$1", [product]);
    await db.query("UPDATE product_images SET priority=0 WHERE id=$1", [image]);
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
    return this.list(product, db);
  },

  async reprocess(productId, imageId, db = pool) {
    const product = positiveId(productId, "productId"); const image = positiveId(imageId, "imageId");
    const result = await db.query(`UPDATE product_images SET processing_status='PROCESSING',processing_error=NULL
      WHERE id=$1 AND product_id=$2 RETURNING id`, [image, product]);
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
      processed_storage_key_1200,processed_storage_key_800,processed_storage_key_400
      FROM product_images WHERE id=$1 AND product_id=$2`,
      [positiveId(imageId, "imageId"), positiveId(productId, "productId")]);
    if (!result.rows[0]) throw new Error("Изображение не найдено");
    const row = result.rows[0];
    await removeKeys([row.storage_key,row.original_storage_key,row.processed_storage_key_1600,
      row.processed_storage_key_1200,row.processed_storage_key_800,row.processed_storage_key_400]);
    await db.query("DELETE FROM product_images WHERE id=$1", [positiveId(imageId, "imageId")]);
  },
};
