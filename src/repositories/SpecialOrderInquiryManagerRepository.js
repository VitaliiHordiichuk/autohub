import { pool } from "../config/db.js";

const STATUSES = new Set([
  "NEW", "IN_PROGRESS", "ANSWERED", "CLOSED",
]);

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_INQUIRY_REQUEST";
  throw error;
}

function positiveInteger(value, fallback, maximum) {
  if (value == null) return fallback;
  const n = Number(value);

  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) {
    invalid("Некоректна сторінка або кількість записів");
  }

  return n;
}

function present(row) {
  return {
    id: Number(row.id),
    userId: row.user_id == null ? null : Number(row.user_id),
    article: row.article,
    contactPhone: row.contact_phone,
    contactName: row.contact_name,
    quantity: Number(row.quantity),
    locale: row.locale,
    source: row.source,
    status: row.status,
    estimatedUnitPriceUah: Number(row.estimated_unit_price_uah),
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const SpecialOrderInquiryManagerRepository = {
  async list({ status = null, page = 1, limit = 25 } = {}, db = pool) {
    const safePage = positiveInteger(page, 1, 10000);
    const safeLimit = positiveInteger(limit, 25, 100);

    if (status != null && !STATUSES.has(status)) {
      invalid("Некоректний статус заявки");
    }

    const offset = (safePage - 1) * safeLimit;

    const result = await db.query(`
      SELECT
        id, user_id, article, contact_phone, contact_name,
        quantity, locale, source, status,
        estimated_unit_price_uah, currency,
        created_at, updated_at
      FROM special_order_inquiries
      WHERE ($1::varchar IS NULL OR status = $1)
      ORDER BY
        CASE status
          WHEN 'NEW' THEN 0
          WHEN 'IN_PROGRESS' THEN 1
          WHEN 'ANSWERED' THEN 2
          ELSE 3
        END,
        created_at DESC, id DESC
      LIMIT $2 OFFSET $3
    `, [status, safeLimit, offset]);

    return {
      items: result.rows.map(present),
      page: safePage,
      limit: safeLimit,
    };
  },

  async updateStatus({ id, status }, db = pool) {
    const numericId = Number(id);

    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      invalid("Некоректний номер заявки");
    }

    if (!STATUSES.has(status)) {
      invalid("Некоректний статус заявки");
    }

    const result = await db.query(`
      UPDATE special_order_inquiries
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING
        id, user_id, article, contact_phone, contact_name,
        quantity, locale, source, status,
        estimated_unit_price_uah, currency,
        created_at, updated_at
    `, [numericId, status]);

    return result.rows[0] ? present(result.rows[0]) : null;
  },
};
