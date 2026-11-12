import { pool } from "../config/db.js";

const LOCK_NAMESPACE = 12710;

export const SpecialOrderInquiryRepository = {

  async lockPhone(phone, db) {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext($1::text), $2::integer)",
      [phone, LOCK_NAMESPACE]
    );
  },

  async recentCounts({ phone, article }, db) {
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 hour'
        )::integer AS hour_count,

        COUNT(*) FILTER (
          WHERE created_at >= NOW() - INTERVAL '24 hours'
        )::integer AS day_count,

        COUNT(*) FILTER (
          WHERE created_at >= NOW() - INTERVAL '15 minutes'
          AND article = $2
        )::integer AS duplicate_count

      FROM special_order_inquiries
      WHERE contact_phone = $1
        AND created_at >= NOW() - INTERVAL '24 hours'
    `, [phone, article]);

    return {
      hourCount: Number(result.rows[0]?.hour_count || 0),
      dayCount: Number(result.rows[0]?.day_count || 0),
      duplicateCount: Number(result.rows[0]?.duplicate_count || 0),
    };
  },

  async create({
    userId,
    article,
    contactPhone,
    contactName,
    quantity,
    locale,
    source,
    estimatedUnitPriceUah,
  }, db = pool) {

    const result = await db.query(`
      INSERT INTO special_order_inquiries (
        user_id,
        article,
        contact_phone,
        contact_name,
        quantity,
        locale,
        source,
        status,
        estimated_unit_price_uah,
        currency,
        consent_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        'NEW',$8,'UAH',NOW()
      )
      RETURNING id, article, quantity, status,
                estimated_unit_price_uah,
                currency, created_at
    `, [
      userId,
      article,
      contactPhone,
      contactName,
      quantity,
      locale,
      source,
      estimatedUnitPriceUah,
    ]);

    return result.rows[0];
  },
};
