import { pool } from "../config/db.js";
import { ProductImageProcessor } from "./ProductImageProcessor.js";
import {
  buildMerchantImageStorageKey,
  createProductImageStorage,
} from "./ProductImageService.js";

export const MERCHANT_IMAGE_BACKFILL_DEFAULT_LIMIT = 50;
export const MERCHANT_IMAGE_BACKFILL_MAX_LIMIT = 500;
export const MERCHANT_IMAGE_BACKFILL_REASONS = Object.freeze([
  "already_has_merchant",
  "missing_original",
  "original_not_accessible",
  "processing_error",
  "upload_error",
  "db_update_error",
]);

function integerOption(value, { name, minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function initialSummary({ limit, cursor, dryRun, totalCandidates }) {
  return {
    dryRun,
    limit,
    cursor,
    nextCursor: cursor,
    totalCandidates,
    scanned: 0,
    eligible: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    reasons: Object.fromEntries(
      MERCHANT_IMAGE_BACKFILL_REASONS.map((reason) => [reason, 0]),
    ),
    details: [],
  };
}

function addResult(summary, row, status, reason = null, error = null) {
  if (status === "processed") summary.processed += 1;
  if (status === "skipped") summary.skipped += 1;
  if (status === "failed") summary.failed += 1;
  if (reason) summary.reasons[reason] += 1;
  summary.details.push({
    imageId: Number(row.id),
    productId: Number(row.product_id),
    article: row.article || null,
    status,
    ...(reason ? { reason } : {}),
    ...(error ? { error: errorMessage(error) } : {}),
  });
}

async function loadCandidates(db, { limit, cursor }) {
  const [countResult, rowsResult] = await Promise.all([
    db.query(`SELECT COUNT(*)::integer AS total
      FROM product_images
      WHERE id > $1
        AND (merchant_url_1500 IS NULL OR merchant_storage_key_1500 IS NULL)`, [cursor]),
    db.query(`SELECT pi.id,pi.product_id,pi.original_url,pi.original_storage_key,
        pi.merchant_url_1500,pi.merchant_storage_key_1500,p.article
      FROM product_images pi
      JOIN products p ON p.id=pi.product_id
      WHERE pi.id > $1
        AND (pi.merchant_url_1500 IS NULL OR pi.merchant_storage_key_1500 IS NULL)
      ORDER BY pi.id
      LIMIT $2`, [cursor, limit]),
  ]);
  return {
    totalCandidates: Number(countResult.rows[0]?.total || 0),
    rows: rowsResult.rows,
  };
}

async function removeUploadedQuietly(storage, storageKey) {
  await storage.remove(storageKey).catch(() => {});
}

export async function backfillMerchantImages({
  limit = MERCHANT_IMAGE_BACKFILL_DEFAULT_LIMIT,
  cursor = 0,
  dryRun = false,
} = {}, dependencies = {}) {
  const safeLimit = integerOption(limit, {
    name: "limit",
    minimum: 1,
    maximum: MERCHANT_IMAGE_BACKFILL_MAX_LIMIT,
  });
  const safeCursor = integerOption(cursor, {
    name: "cursor",
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  });
  const db = dependencies.db || pool;
  const candidateLoader = dependencies.loadCandidates || loadCandidates;
  const candidateSet = await candidateLoader(db, {
    limit: safeLimit,
    cursor: safeCursor,
  });
  const rows = Array.isArray(candidateSet.rows) ? candidateSet.rows : [];
  const summary = initialSummary({
    limit: safeLimit,
    cursor: safeCursor,
    dryRun: Boolean(dryRun),
    totalCandidates: Number(candidateSet.totalCandidates || rows.length),
  });
  let storage = dependencies.storage || null;
  const processMerchant = dependencies.processMerchant
    || ProductImageProcessor.processMerchant;

  for (const row of rows) {
    summary.scanned += 1;
    summary.nextCursor = Math.max(summary.nextCursor, Number(row.id) || 0);

    if (row.merchant_url_1500 && row.merchant_storage_key_1500) {
      addResult(summary, row, "skipped", "already_has_merchant");
      continue;
    }
    if (!row.original_storage_key) {
      addResult(summary, row, "skipped", "missing_original");
      continue;
    }

    summary.eligible += 1;
    if (summary.dryRun) {
      addResult(summary, row, "would_process");
      continue;
    }

    if (!storage) storage = createProductImageStorage();
    let original;
    try {
      original = await storage.read(row.original_storage_key);
    } catch (error) {
      addResult(summary, row, "skipped", "original_not_accessible", error);
      continue;
    }

    let merchant;
    try {
      merchant = await processMerchant(original);
    } catch (error) {
      addResult(summary, row, "failed", "processing_error", error);
      continue;
    }

    const merchantKey = buildMerchantImageStorageKey({
      productId: row.product_id,
      imageId: row.id,
      article: row.article,
    });
    try {
      await storage.uploadWebp(merchantKey, merchant.variant);
    } catch (error) {
      await removeUploadedQuietly(storage, merchantKey);
      addResult(summary, row, "failed", "upload_error", error);
      continue;
    }

    try {
      const updated = await db.query(`UPDATE product_images
        SET merchant_url_1500=$2,merchant_storage_key_1500=$3
        WHERE id=$1
          AND (merchant_url_1500 IS NULL OR merchant_storage_key_1500 IS NULL)
        RETURNING id`, [row.id, storage.publicUrl(merchantKey), merchantKey]);
      if (!updated.rows[0]) {
        await removeUploadedQuietly(storage, merchantKey);
        addResult(summary, row, "skipped", "already_has_merchant");
        continue;
      }
      addResult(summary, row, "processed");
    } catch (error) {
      await removeUploadedQuietly(storage, merchantKey);
      addResult(summary, row, "failed", "db_update_error", error);
    }
  }

  summary.hasMore = summary.totalCandidates > summary.scanned;
  return summary;
}

export const MerchantImageBackfillService = {
  run: backfillMerchantImages,
};
