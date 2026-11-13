/**
 * Transactional outbox for special-order inquiries.
 * No network activity. All queries are parameterized.
 * The send worker must never hold an SQL transaction while calling Telegram.
 */
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { transaction } from '../db/transaction.js';

const MAX_DELIVERY_ATTEMPTS = 8;
const STAFF_SQL = `
  SELECT DISTINCT c.telegram_chat_id::text AS telegram_chat_id
  FROM user_telegram_connections c
  JOIN users u ON u.id = c.user_id
  JOIN employee_profiles ep ON ep.user_id = u.id
  WHERE c.notifications_enabled = TRUE
    AND c.telegram_chat_id = c.telegram_user_id
    AND u.is_active = TRUE AND ep.access_enabled = TRUE
    AND ep.telegram_allowed = TRUE
    AND ep.order_notifications_enabled = TRUE
    AND ep.removed_at IS NULL
    AND ep.staff_role IN ('ADMIN','MANAGER')
`;

export async function enqueueSpecialOrderInquiryNotification(inquiryId, db) {
  if (!db || typeof db.query !== 'function' ||
      !Number.isSafeInteger(Number(inquiryId)) || Number(inquiryId) <= 0) {
    throw new Error('INVALID_OUTBOX_ENQUEUE');
  }
  const result = await db.query(`
    INSERT INTO special_order_inquiry_notification_outbox(inquiry_id)
    VALUES ($1) RETURNING id
  `, [Number(inquiryId)]);
  if (result.rows.length !== 1) throw new Error('OUTBOX_ENQUEUE_FAILED');
  return result.rows[0].id;
}

/**
 * Expands one event into one delivery per currently authorized staff member.
 * No eligible staff => event stays PENDING (future retry), not silently dropped.
 */
export async function expandOneSpecialOrderInquiryNotification(
  { runTransaction = transaction } = {}
) {
  return runTransaction(async db => {
    const pending = await db.query(`
      SELECT id FROM special_order_inquiry_notification_outbox
      WHERE status='PENDING' AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at, id
      LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    const eventId = pending.rows[0]?.id;
    if (!eventId) return { kind: 'EMPTY' };

    const eligible = await db.query(STAFF_SQL);
    if (!eligible.rows.length) {
      await db.query(`
        UPDATE special_order_inquiry_notification_outbox
        SET preparation_attempts=preparation_attempts+1,
            next_attempt_at=NOW()+INTERVAL '5 minutes', updated_at=NOW()
        WHERE id=$1
      `, [eventId]);
      return { kind: 'NO_ELIGIBLE_STAFF' };
    }

    await db.query(`
      INSERT INTO special_order_inquiry_notification_deliveries(outbox_id, telegram_chat_id)
      SELECT $1, staff.telegram_chat_id FROM (${STAFF_SQL}) staff
      WHERE TRUE
      ON CONFLICT (outbox_id, telegram_chat_id) DO NOTHING
    `, [eventId]);
    const ready = await db.query(`
      SELECT COUNT(*)::integer AS n
      FROM special_order_inquiry_notification_deliveries
      WHERE outbox_id=$1
    `, [eventId]);
    if (Number(ready.rows[0]?.n || 0) < 1) {
      // Staff eligibility may have changed in between; retry later.
      await db.query(`
        UPDATE special_order_inquiry_notification_outbox
        SET next_attempt_at=NOW()+INTERVAL '5 minutes', updated_at=NOW()
        WHERE id=$1
      `, [eventId]);
      return { kind: 'NO_ELIGIBLE_STAFF' };
    }
    await db.query(`
      UPDATE special_order_inquiry_notification_outbox
      SET status='EXPANDED', updated_at=NOW()
      WHERE id=$1
    `, [eventId]);
    return { kind: 'EXPANDED' };
  });
}

/**
 * Atomic claim using SKIP LOCKED. Expired IN_FLIGHT leases are retried:
 * at-least-once delivery; Telegram may duplicate after ambiguous network failures.
 */
export async function claimSpecialOrderInquiryDelivery(db = pool) {
  await db.query(`
    UPDATE special_order_inquiry_notification_deliveries
    SET status='FAILED', claim_token=NULL, lease_until=NULL,
        last_error_code='LEASE_EXHAUSTED', updated_at=NOW()
    WHERE status='IN_FLIGHT' AND lease_until <= NOW() AND attempts >= $1
  `, [MAX_DELIVERY_ATTEMPTS]);

  const token = randomUUID();
  const result = await db.query(`
    WITH candidate AS (
      SELECT id FROM special_order_inquiry_notification_deliveries
      WHERE (
        (status='PENDING' AND next_attempt_at <= NOW()) OR
        (status='IN_FLIGHT' AND lease_until <= NOW())
      ) AND attempts < $1
      ORDER BY next_attempt_at, id
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE special_order_inquiry_notification_deliveries d
    SET status='IN_FLIGHT', attempts=d.attempts+1,
        claim_token=$2::uuid, lease_until=NOW()+INTERVAL '120 seconds',
        updated_at=NOW()
    FROM candidate
    WHERE d.id=candidate.id
    RETURNING d.id, d.claim_token, d.attempts, d.telegram_chat_id
  `, [MAX_DELIVERY_ATTEMPTS, token]);
  return result.rows[0] || null;
}

export async function loadSpecialOrderInquiryDelivery(delivery, db = pool) {
  const result = await db.query(`
    SELECT i.id, i.article, i.quantity,
           i.estimated_unit_price_uah, i.contact_name, i.contact_phone,
           i.source, i.status AS inquiry_status,
           EXISTS (
             SELECT 1 FROM user_telegram_connections c
             JOIN users u ON u.id=c.user_id
             JOIN employee_profiles ep ON ep.user_id=u.id
             WHERE c.telegram_chat_id::text=$3
               AND c.telegram_chat_id=c.telegram_user_id
               AND c.notifications_enabled=TRUE
               AND u.is_active=TRUE AND ep.access_enabled=TRUE
               AND ep.telegram_allowed=TRUE
               AND ep.order_notifications_enabled=TRUE
               AND ep.removed_at IS NULL
               AND ep.staff_role IN ('ADMIN', 'MANAGER')
           ) AS still_authorized
    FROM special_order_inquiry_notification_deliveries d
    JOIN special_order_inquiry_notification_outbox o ON o.id=d.outbox_id
    JOIN special_order_inquiries i ON i.id=o.inquiry_id
    WHERE d.id=$1 AND d.claim_token=$2::uuid AND d.status='IN_FLIGHT'
  `, [delivery.id, delivery.claim_token, delivery.telegram_chat_id]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    stillAuthorized: row.still_authorized === true && row.inquiry_status !== 'CLOSED',
    event: {
      id: Number(row.id), article: row.article, quantity: Number(row.quantity),
      estimatedUnitPriceUah: Number(row.estimated_unit_price_uah),
      contactName: row.contact_name, contactPhone: row.contact_phone,
      source: row.source,
    },
  };
}

export async function finishSpecialOrderInquiryDelivery(
  { id, claim_token }, outcome, db = pool
) {
  if (!['SENT', 'SKIPPED', 'RETRY'].includes(outcome)) {
    throw new Error('INVALID_DELIVERY_OUTCOME');
  }
  const result = await db.query(`
    UPDATE special_order_inquiry_notification_deliveries
    SET status = CASE
      WHEN $3='SENT' THEN 'SENT'
      WHEN $3='SKIPPED' THEN 'SKIPPED'
      WHEN attempts >= $4 THEN 'FAILED'
      ELSE 'PENDING' END,
      last_error_code = CASE WHEN $3='RETRY' THEN 'SEND_FAILED' ELSE NULL END,
      claim_token=NULL, lease_until=NULL,
      next_attempt_at = CASE WHEN $3='RETRY'
        THEN NOW() + make_interval(secs => LEAST(3600, 30 * POWER(2, LEAST(attempts, 7) - 1))::integer)
        ELSE next_attempt_at END,
      sent_at = CASE WHEN $3='SENT' THEN NOW() ELSE sent_at END,
      updated_at=NOW()
    WHERE id=$1 AND claim_token=$2::uuid AND status='IN_FLIGHT'
    RETURNING status
  `, [id, claim_token, outcome, MAX_DELIVERY_ATTEMPTS]);
  if (result.rows.length !== 1) {
    // Lease was reclaimed by another worker; do not overwrite its new state.
    throw new Error('OUTBOX_CLAIM_LOST');
  }
  return result.rows[0].status;
}
