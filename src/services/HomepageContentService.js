import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { pool } from "../config/db.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { OfferService } from "./OfferService.js";

const IMAGE_FIELDS = ["desktop", "tablet", "mobile"];
const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

function positiveId(value, label = "ідентифікатор") {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) {
    throw new Error(`Некоректний ${label}`);
  }
  return result;
}

function normalizeLocale(value) {
  return String(value || "").toLowerCase() === "en" ? "en" : "uk";
}

function cleanText(value, label, maxLength) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`Заповніть поле «${label}»`);
  if (result.length > maxLength) {
    throw new Error(`Поле «${label}» задовге`);
  }
  return result;
}

function optionalDate(value, label) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const result = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new Error(`Поле «${label}» має бути датою у форматі РРРР-ММ-ДД`);
  }
  const parsed = new Date(`${result}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error(`Поле «${label}» містить некоректну дату`);
  }
  return result;
}

function optionalBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Некоректне логічне значення");
}

function storageConfig() {
  const config = {
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    publicBaseUrl: String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  };
  if (Object.values(config).some((value) => !value)) {
    throw new Error("Сховище зображень ще не налаштоване. Перевірте R2-змінні середовища.");
  }
  return config;
}

function storageClient(config) {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

async function uploadBannerImage(file, slot) {
  if (!file) throw new Error(`Завантажте зображення для ${slot}`);
  const extension = MIME_EXTENSIONS.get(file.mimetype);
  if (!extension) throw new Error("Банери підтримують формати JPG, PNG та WEBP");
  const config = storageConfig();
  const storageKey = `homepage/banners/${randomUUID()}-${slot}${extension}`;
  await storageClient(config).send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: storageKey,
    Body: file.buffer,
    ContentType: file.mimetype,
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return { storageKey, url: `${config.publicBaseUrl}/${storageKey}` };
}

async function removeStorageObjects(keys) {
  const storageKeys = [...new Set(keys.filter(Boolean))];
  if (!storageKeys.length) return;
  const config = storageConfig();
  const client = storageClient(config);
  await Promise.allSettled(storageKeys.map((key) => client.send(new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: key,
  }))));
}

function filesBySlot(files = []) {
  return Object.fromEntries(IMAGE_FIELDS.map((slot) => [
    slot,
    files.find((file) => file.fieldname === `${slot}Image`) || null,
  ]));
}

function presentBanner(row, locale) {
  if (!row) return null;
  const english = locale === "en";
  return {
    id: Number(row.id),
    scheduledDate: row.scheduled_date || null,
    title: english ? row.title_en : row.title_uk,
    description: english ? row.description_en : row.description_uk,
    images: {
      desktop: row.desktop_image_url,
      tablet: row.tablet_image_url,
      mobile: row.mobile_image_url,
    },
  };
}

function presentAdminBanner(row) {
  return {
    id: Number(row.id),
    scheduledDate: row.scheduled_date || null,
    titleUk: row.title_uk,
    descriptionUk: row.description_uk,
    titleEn: row.title_en,
    descriptionEn: row.description_en,
    images: {
      desktop: row.desktop_image_url,
      tablet: row.tablet_image_url,
      mobile: row.mobile_image_url,
    },
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bannerValues(data, current = null) {
  return {
    scheduledDate: data.scheduledDate === undefined
      ? current?.scheduled_date ?? null
      : optionalDate(data.scheduledDate, "Дата показу"),
    titleUk: data.titleUk === undefined
      ? current?.title_uk
      : cleanText(data.titleUk, "Заголовок українською", 180),
    descriptionUk: data.descriptionUk === undefined
      ? current?.description_uk
      : cleanText(data.descriptionUk, "Опис українською", 1200),
    titleEn: data.titleEn === undefined
      ? current?.title_en
      : cleanText(data.titleEn, "Заголовок англійською", 180),
    descriptionEn: data.descriptionEn === undefined
      ? current?.description_en
      : cleanText(data.descriptionEn, "Опис англійською", 1200),
    isActive: optionalBoolean(data.isActive, current ? Boolean(current.is_active) : true),
  };
}

async function findProduct(article, db = pool) {
  const raw = cleanText(article, "Артикул", 120);
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const result = await db.query(`
    SELECT p.id, p.article, p.name
    FROM products p
    WHERE p.is_active = TRUE
      AND (
        UPPER(COALESCE(p.article_normalized, '')) = $1
        OR UPPER(REGEXP_REPLACE(p.article, '[^A-Za-z0-9]', '', 'g')) = $1
        OR UPPER(p.article) = UPPER($2)
      )
    ORDER BY CASE WHEN UPPER(p.article) = UPPER($2) THEN 0 ELSE 1 END, p.id
    LIMIT 1`, [normalized, raw]);
  if (!result.rows[0]) throw new Error("Товар із таким артикулом не знайдено");
  return result.rows[0];
}

function featureValues(data, current = null) {
  const featureType = String(data.featureType ?? current?.feature_type ?? "").toUpperCase();
  if (!new Set(["PROMOTION", "NEW"]).has(featureType)) {
    throw new Error("Оберіть тип «Акція» або «Новинка»");
  }
  const rawDiscount = data.discountPercent === undefined
    ? current?.discount_percent
    : data.discountPercent;
  const discount = rawDiscount === null || rawDiscount === undefined || rawDiscount === ""
    ? null
    : Number(rawDiscount);
  if (featureType === "PROMOTION" && (!Number.isFinite(discount) || discount <= 0 || discount >= 100)) {
    throw new Error("Для акції вкажіть знижку від 0,01% до 99,99%");
  }
  const sortOrder = Number(data.sortOrder ?? current?.sort_order ?? 100);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
    throw new Error("Порядок показу має бути цілим числом від 0 до 100000");
  }
  return {
    featureType,
    discountPercent: featureType === "PROMOTION" ? Number(discount.toFixed(2)) : null,
    startsOn: data.startsOn === undefined
      ? current?.starts_on ?? null
      : optionalDate(data.startsOn, "Початок показу"),
    endsOn: data.endsOn === undefined
      ? current?.ends_on ?? null
      : optionalDate(data.endsOn, "Кінець показу"),
    sortOrder,
    isActive: optionalBoolean(data.isActive, current ? Boolean(current.is_active) : true),
  };
}

function presentAdminFeature(row) {
  return {
    id: Number(row.id),
    featureType: row.feature_type,
    article: row.article,
    productName: row.name,
    imageUrl: row.image_url || null,
    discountPercent: row.discount_percent === null ? null : Number(row.discount_percent),
    startsOn: row.starts_on || null,
    endsOn: row.ends_on || null,
    sortOrder: Number(row.sort_order),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listFeatureRows(where, values, db = pool) {
  const result = await db.query(`
    SELECT f.*, p.article, p.name,
      (SELECT pt.name FROM product_translations pt
       WHERE pt.product_id = p.id AND pt.language_code = 'uk' LIMIT 1) AS name_uk,
      (SELECT pt.name FROM product_translations pt
       WHERE pt.product_id = p.id AND pt.language_code = 'en' LIMIT 1) AS name_en,
      (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id
       ORDER BY pi.priority, pi.id LIMIT 1) AS image_url
    FROM homepage_product_features f
    JOIN products p ON p.id = f.product_id
    ${where}
    ORDER BY f.sort_order, f.id`, values);
  return result.rows;
}

export const HomepageContentService = {
  async getPublic({ locale: requestedLocale, userId = null, date = null } = {}, db = pool) {
    const locale = normalizeLocale(requestedLocale);
    const displayDate = optionalDate(date, "Дата") || new Date().toISOString().slice(0, 10);
    const [bannerResult, featureRows, pricingContext] = await Promise.all([
      db.query(`
        SELECT * FROM homepage_banners
        WHERE is_active = TRUE
        ORDER BY
          CASE WHEN scheduled_date = $1::date THEN 0 ELSE 1 END,
          MD5(id::text || $1::text)
        LIMIT 1`, [displayDate]),
      listFeatureRows(`WHERE f.is_active = TRUE
        AND p.is_active = TRUE
        AND (f.starts_on IS NULL OR f.starts_on <= $1::date)
        AND (f.ends_on IS NULL OR f.ends_on >= $1::date)`, [displayDate], db),
      CustomerPricingService.getContext(userId, db),
    ]);

    const features = await Promise.all(featureRows.map(async (row) => {
      const offers = await OfferService.getOffersByProductId(row.product_id, pricingContext);
      const offer = offers
        .filter((item) => item.isAvailable && item.retailPrice !== null)
        .sort((first, second) => Number(first.retailPrice) - Number(second.retailPrice))[0] || null;
      return {
        id: Number(row.id),
        featureType: row.feature_type,
        discountPercent: row.discount_percent === null ? null : Number(row.discount_percent),
        product: {
          id: Number(row.product_id),
          article: row.article,
          name: row[`name_${locale}`] || row.name_uk || row.name,
          imageUrl: row.image_url || "/landing/product-placeholder.svg",
        },
        offer: offer ? {
          id: offer.id,
          price: offer.retailPrice,
          isAvailable: offer.isAvailable,
        } : null,
      };
    }));

    return {
      date: displayDate,
      locale,
      banner: presentBanner(bannerResult.rows[0], locale),
      features,
    };
  },

  async listBanners(db = pool) {
    const result = await db.query(`SELECT * FROM homepage_banners
      ORDER BY scheduled_date DESC NULLS LAST, updated_at DESC, id DESC`);
    return result.rows.map(presentAdminBanner);
  },

  async createBanner(data, files, userId, db = pool) {
    const values = bannerValues(data);
    const bySlot = filesBySlot(files);
    const uploaded = {};
    try {
      for (const slot of IMAGE_FIELDS) uploaded[slot] = await uploadBannerImage(bySlot[slot], slot);
      const result = await db.query(`
        INSERT INTO homepage_banners(
          scheduled_date, title_uk, description_uk, title_en, description_en,
          desktop_image_url, tablet_image_url, mobile_image_url,
          desktop_storage_key, tablet_storage_key, mobile_storage_key,
          is_active, created_by, updated_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
        RETURNING *`, [
        values.scheduledDate, values.titleUk, values.descriptionUk,
        values.titleEn, values.descriptionEn,
        uploaded.desktop.url, uploaded.tablet.url, uploaded.mobile.url,
        uploaded.desktop.storageKey, uploaded.tablet.storageKey, uploaded.mobile.storageKey,
        values.isActive, positiveId(userId, "користувач"),
      ]);
      return presentAdminBanner(result.rows[0]);
    } catch (error) {
      await removeStorageObjects(Object.values(uploaded).map((item) => item?.storageKey));
      throw error;
    }
  },

  async updateBanner(bannerId, data, files, userId, db = pool) {
    const id = positiveId(bannerId, "номер банера");
    const currentResult = await db.query("SELECT * FROM homepage_banners WHERE id = $1", [id]);
    const current = currentResult.rows[0];
    if (!current) throw new Error("Банер не знайдено");
    const values = bannerValues(data, current);
    const bySlot = filesBySlot(files);
    const uploaded = {};
    try {
      for (const slot of IMAGE_FIELDS) {
        if (bySlot[slot]) uploaded[slot] = await uploadBannerImage(bySlot[slot], slot);
      }
      const result = await db.query(`
        UPDATE homepage_banners SET
          scheduled_date=$2, title_uk=$3, description_uk=$4,
          title_en=$5, description_en=$6,
          desktop_image_url=$7, tablet_image_url=$8, mobile_image_url=$9,
          desktop_storage_key=$10, tablet_storage_key=$11, mobile_storage_key=$12,
          is_active=$13, updated_by=$14, updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 RETURNING *`, [
        id, values.scheduledDate, values.titleUk, values.descriptionUk,
        values.titleEn, values.descriptionEn,
        uploaded.desktop?.url || current.desktop_image_url,
        uploaded.tablet?.url || current.tablet_image_url,
        uploaded.mobile?.url || current.mobile_image_url,
        uploaded.desktop?.storageKey || current.desktop_storage_key,
        uploaded.tablet?.storageKey || current.tablet_storage_key,
        uploaded.mobile?.storageKey || current.mobile_storage_key,
        values.isActive, positiveId(userId, "користувач"),
      ]);
      await removeStorageObjects(IMAGE_FIELDS
        .filter((slot) => uploaded[slot])
        .map((slot) => current[`${slot}_storage_key`]));
      return presentAdminBanner(result.rows[0]);
    } catch (error) {
      await removeStorageObjects(Object.values(uploaded).map((item) => item?.storageKey));
      throw error;
    }
  },

  async deleteBanner(bannerId, db = pool) {
    const result = await db.query("DELETE FROM homepage_banners WHERE id=$1 RETURNING *", [
      positiveId(bannerId, "номер банера"),
    ]);
    const row = result.rows[0];
    if (!row) throw new Error("Банер не знайдено");
    await removeStorageObjects(IMAGE_FIELDS.map((slot) => row[`${slot}_storage_key`]));
  },

  async listFeatures(db = pool) {
    return (await listFeatureRows("", [], db)).map(presentAdminFeature);
  },

  async createFeature(data, userId, db = pool) {
    const product = await findProduct(data.article, db);
    const values = featureValues(data);
    const result = await db.query(`
      INSERT INTO homepage_product_features(
        feature_type, product_id, discount_percent, starts_on, ends_on,
        sort_order, is_active, created_by, updated_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)
      RETURNING id`, [
      values.featureType, product.id, values.discountPercent, values.startsOn,
      values.endsOn, values.sortOrder, values.isActive,
      positiveId(userId, "користувач"),
    ]);
    const rows = await listFeatureRows("WHERE f.id=$1", [result.rows[0].id], db);
    return presentAdminFeature(rows[0]);
  },

  async updateFeature(featureId, data, userId, db = pool) {
    const id = positiveId(featureId, "номер добірки");
    const currentResult = await db.query("SELECT * FROM homepage_product_features WHERE id=$1", [id]);
    const current = currentResult.rows[0];
    if (!current) throw new Error("Елемент добірки не знайдено");
    const values = featureValues(data, current);
    const product = data.article === undefined
      ? { id: current.product_id }
      : await findProduct(data.article, db);
    await db.query(`UPDATE homepage_product_features SET
      feature_type=$2, product_id=$3, discount_percent=$4,
      starts_on=$5, ends_on=$6, sort_order=$7, is_active=$8,
      updated_by=$9, updated_at=CURRENT_TIMESTAMP
      WHERE id=$1`, [
      id, values.featureType, product.id, values.discountPercent,
      values.startsOn, values.endsOn, values.sortOrder, values.isActive,
      positiveId(userId, "користувач"),
    ]);
    const rows = await listFeatureRows("WHERE f.id=$1", [id], db);
    return presentAdminFeature(rows[0]);
  },

  async deleteFeature(featureId, db = pool) {
    const result = await db.query("DELETE FROM homepage_product_features WHERE id=$1 RETURNING id", [
      positiveId(featureId, "номер добірки"),
    ]);
    if (!result.rows[0]) throw new Error("Елемент добірки не знайдено");
  },
};
