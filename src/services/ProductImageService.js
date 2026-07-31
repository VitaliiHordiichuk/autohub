import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pool } from "../config/db.js";

const mimeExtensions = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"], ["image/gif", ".gif"],
]);

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

export const ProductImageService = {
  async searchProducts(search = "", db = pool) {
    const query = String(search).trim();
    if (query.length < 2) return [];
    const result = await db.query(`
      SELECT p.id, p.article, p.name, b.name AS brand_name,
             (SELECT pi.url FROM product_images pi WHERE pi.product_id=p.id ORDER BY pi.priority,pi.id LIMIT 1) AS image_url,
             (SELECT COUNT(*)::integer FROM product_images pi WHERE pi.product_id=p.id) AS image_count
      FROM products p LEFT JOIN brands b ON b.id=p.brand_id
      WHERE p.article ILIKE '%' || $1 || '%' OR p.name ILIKE '%' || $1 || '%'
      ORDER BY CASE WHEN p.article ILIKE $1 || '%' THEN 0 ELSE 1 END,p.article LIMIT 30`, [query]);
    return result.rows;
  },

  async list(productId, db = pool) {
    const result = await db.query(`SELECT id,product_id,url,source,priority,created_at
      FROM product_images WHERE product_id=$1 ORDER BY priority,id`, [positiveId(productId, "productId")]);
    return result.rows;
  },

  async upload(productId, files, db = pool) {
    const id = positiveId(productId, "productId");
    if (!files?.length) throw new Error("Выбери хотя бы одно изображение");
    const exists = await db.query("SELECT 1 FROM products WHERE id=$1", [id]);
    if (!exists.rows[0]) throw new Error("Товар не найден");
    const config = storageConfig();
    const r2 = client(config);
    const current = await db.query("SELECT COALESCE(MAX(priority),-1)::integer AS priority FROM product_images WHERE product_id=$1", [id]);
    let priority = Number(current.rows[0].priority);
    const added = [];
    for (const file of files) {
      const extension = mimeExtensions.get(file.mimetype);
      if (!extension) throw new Error("Поддерживаются JPG, PNG, WEBP и GIF");
      const storageKey = `products/${id}/${randomUUID()}${extension}`;
      await r2.send(new PutObjectCommand({ Bucket: config.bucket, Key: storageKey,
        Body: file.buffer, ContentType: file.mimetype, CacheControl: "public, max-age=31536000, immutable" }));
      const url = `${config.publicBaseUrl}/${storageKey}`;
      let result;
      try {
        result = await db.query(`INSERT INTO product_images(product_id,url,source,priority,storage_key)
          VALUES($1,$2,'R2',$3,$4) RETURNING *`, [id, url, ++priority, storageKey]);
      } catch (error) {
        await r2.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey })).catch(() => {});
        throw error;
      }
      added.push(result.rows[0]);
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

  async remove(productId, imageId, db = pool) {
    const result = await db.query("SELECT storage_key FROM product_images WHERE id=$1 AND product_id=$2",
      [positiveId(imageId, "imageId"), positiveId(productId, "productId")]);
    if (!result.rows[0]) throw new Error("Изображение не найдено");
    const storageKey = result.rows[0].storage_key;
    if (storageKey) {
      const config = storageConfig();
      await client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey }));
    }
    await db.query("DELETE FROM product_images WHERE id=$1", [positiveId(imageId, "imageId")]);
  },
};
