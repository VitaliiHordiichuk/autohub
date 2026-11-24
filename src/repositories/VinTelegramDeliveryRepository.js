import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

const maxBigint = 9223372036854775807n;
const epoch = 'EXTRACT(EPOCH FROM NOW())';
const attempts = `CASE WHEN (n.payload #>> '{telegramVin,attempts}') ~ '^[0-9]{1,2}$'
  THEN (n.payload #>> '{telegramVin,attempts}')::integer ELSE 8 END`;
const nextAttempt = `CASE WHEN (n.payload #>> '{telegramVin,nextAttemptAt}') ~ '^[0-9]{1,12}$'
  THEN (n.payload #>> '{telegramVin,nextAttemptAt}')::bigint ELSE 0 END`;
const leaseUntil = `CASE WHEN (n.payload #>> '{telegramVin,leaseUntil}') ~ '^[0-9]{1,12}$'
  THEN (n.payload #>> '{telegramVin,leaseUntil}')::bigint ELSE 0 END`;
const expired = `n.created_at < NOW() - INTERVAL '7 days'`;

// Only new, explicitly marked VIN events participate. Historical notifications,
// other event types and their read/unread state are never consumed here.
export const VIN_TELEGRAM_SQL = Object.freeze({
  claim: `WITH candidate AS (
    SELECT n.id, ${attempts} AS attempts,
      (${expired}) AS expired
    FROM user_notifications n
    WHERE n.type IN ('VIN_REQUEST_NEW','VIN_REQUEST_UPDATED')
      AND n.payload #>> '{telegramVin,version}' = '1'
      AND n.payload #>> '{telegramVin,event}' IN ('NEW_REQUEST','CLIENT_MESSAGE')
      AND (
        (n.payload #>> '{telegramVin,status}' = 'PENDING'
          AND (${nextAttempt} <= ${epoch} OR ${expired} OR ${attempts} >= 8))
        OR (n.payload #>> '{telegramVin,status}' = 'IN_FLIGHT' AND ${leaseUntil} <= ${epoch})
      )
    ORDER BY n.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED
  )
  UPDATE user_notifications n
  SET payload = jsonb_set(n.payload, '{telegramVin}',
    (n.payload -> 'telegramVin') || jsonb_build_object(
      'status', CASE WHEN candidate.expired OR candidate.attempts >= 8 THEN 'FAILED' ELSE 'IN_FLIGHT' END,
      'attempts', candidate.attempts + CASE WHEN candidate.expired OR candidate.attempts >= 8 THEN 0 ELSE 1 END,
      'claimToken', CASE WHEN candidate.expired OR candidate.attempts >= 8 THEN NULL ELSE $1::text END,
      'leaseUntil', CASE WHEN candidate.expired OR candidate.attempts >= 8 THEN NULL ELSE FLOOR(${epoch})::bigint + 120 END,
      'lastErrorCode', CASE WHEN candidate.expired THEN 'EXPIRED' WHEN candidate.attempts >= 8 THEN 'ATTEMPTS_EXHAUSTED' ELSE NULL END
    ))
  FROM candidate WHERE n.id = candidate.id
  RETURNING n.id::text AS id, n.payload #>> '{telegramVin,status}' AS status,
    (n.payload #>> '{telegramVin,attempts}')::integer AS attempts,
    n.payload #>> '{telegramVin,claimToken}' AS claim_token`,

  load: `SELECT n.id::text AS notification_id, n.user_id,
      n.type AS notification_type, n.payload,
      s.telegram_chat_id::text AS telegram_chat_id,
      COALESCE(lang.locale, 'uk') AS preferred_locale,
      (u.is_active = TRUE AND ep.access_enabled = TRUE AND ep.telegram_allowed = TRUE
        AND ep.removed_at IS NULL AND ep.staff_role IN ('ADMIN','MANAGER')
        AND s.notifications_enabled = TRUE AND s.telegram_chat_id = s.telegram_user_id
        AND s.telegram_chat_id > 0) AS still_authorized,
      (SELECT MIN(n2.user_id)
        FROM user_notifications n2
        JOIN makatron_staff_links s2 ON s2.user_id=n2.user_id
        JOIN users u2 ON u2.id=n2.user_id
        JOIN employee_profiles ep2 ON ep2.user_id=n2.user_id
        WHERE n2.type=n.type
          AND n2.payload ->> 'vinRequestId' = n.payload ->> 'vinRequestId'
          AND n2.payload #>> '{telegramVin,version}' = '1'
          AND n2.payload #>> '{telegramVin,event}' = n.payload #>> '{telegramVin,event}'
          AND COALESCE(n2.payload #>> '{telegramVin,messageId}', '') = COALESCE(n.payload #>> '{telegramVin,messageId}', '')
          AND s2.telegram_chat_id=s.telegram_chat_id AND s2.telegram_chat_id=s2.telegram_user_id
          AND s2.telegram_chat_id > 0 AND s2.notifications_enabled=TRUE
          AND u2.is_active=TRUE AND ep2.access_enabled=TRUE AND ep2.telegram_allowed=TRUE
          AND ep2.removed_at IS NULL AND ep2.staff_role IN ('ADMIN','MANAGER')
      ) AS canonical_user_id,
      EXISTS (SELECT 1 FROM user_notifications sent
        WHERE sent.type=n.type
          AND sent.payload ->> 'vinRequestId' = n.payload ->> 'vinRequestId'
          AND sent.payload #>> '{telegramVin,version}' = '1'
          AND sent.payload #>> '{telegramVin,event}' = n.payload #>> '{telegramVin,event}'
          AND COALESCE(sent.payload #>> '{telegramVin,messageId}', '') = COALESCE(n.payload #>> '{telegramVin,messageId}', '')
          AND sent.payload #>> '{telegramVin,status}' = 'SENT'
          AND sent.payload #>> '{telegramVin,chatId}' = s.telegram_chat_id::text
      ) AS already_sent,
      vr.id::text AS request_id, vr.vin, vr.request_text, vr.contact_phone,
      vr.guest_name, vr.status AS request_status, vb.name AS vehicle_brand_name,
      customer.first_name, customer.last_name, customer.email, customer.phone AS user_phone,
      m.id::text AS message_id, m.message AS client_message
    FROM user_notifications n
    LEFT JOIN users u ON u.id=n.user_id
    LEFT JOIN employee_profiles ep ON ep.user_id=n.user_id
    LEFT JOIN makatron_staff_links s ON s.user_id=n.user_id
    LEFT JOIN telegram_bot_locales lang ON lang.chat_id=s.telegram_chat_id
    LEFT JOIN vin_requests vr ON vr.id::text=n.payload ->> 'vinRequestId'
    LEFT JOIN users customer ON customer.id=vr.user_id
    LEFT JOIN vehicle_brands vb ON vb.id=vr.vehicle_brand_id
    LEFT JOIN vin_request_messages m ON m.id::text=n.payload #>> '{telegramVin,messageId}'
      AND m.vin_request_id=vr.id AND m.sender_user_id=vr.user_id AND m.sender_role='CLIENT'
    WHERE n.id=$1::bigint AND n.payload #>> '{telegramVin,claimToken}'=$2
      AND n.payload #>> '{telegramVin,version}'='1'
      AND n.payload #>> '{telegramVin,status}'='IN_FLIGHT'
      AND ${leaseUntil} > ${epoch}
      AND n.created_at >= NOW() - INTERVAL '7 days'`,

  finish: `UPDATE user_notifications n
    SET payload=jsonb_set(n.payload, '{telegramVin}',
      (n.payload -> 'telegramVin') || jsonb_build_object(
        'status', CASE WHEN $3='SENT' THEN 'SENT' WHEN $3='SKIPPED' THEN 'SKIPPED'
          WHEN ${attempts} >= 8 THEN 'FAILED' ELSE 'PENDING' END,
        'chatId', $4::text, 'claimToken', NULL, 'leaseUntil', NULL,
        'lastErrorCode', CASE WHEN $3='RETRY' THEN 'SEND_FAILED' WHEN $3='SKIPPED' THEN 'NOT_ELIGIBLE' ELSE NULL END,
        'sentAt', CASE WHEN $3='SENT' THEN FLOOR(${epoch})::bigint ELSE NULL END,
        'nextAttemptAt', CASE WHEN $3='RETRY' THEN FLOOR(${epoch})::bigint
          + LEAST(3600, 30 * POWER(2, GREATEST(0, LEAST(${attempts}, 8) - 1)))::bigint ELSE NULL END
      ))
    WHERE n.id=$1::bigint AND n.payload #>> '{telegramVin,claimToken}'=$2
      AND n.payload #>> '{telegramVin,version}'='1'
      AND n.payload #>> '{telegramVin,status}'='IN_FLIGHT'
      AND ${leaseUntil} > ${epoch}
    RETURNING n.payload #>> '{telegramVin,status}' AS status`,
});

function decimalId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  const id = String(value ?? '');
  return /^[1-9][0-9]{0,18}$/.test(id) && BigInt(id) <= maxBigint ? id : null;
}

function claimIdentity(delivery) {
  const id = decimalId(delivery?.id);
  const token = delivery?.claimToken;
  if (!id || typeof token !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(token)) {
    throw new Error('INVALID_VIN_DELIVERY_CLAIM');
  }
  return [id, token];
}

export async function claimVinTelegramDelivery(db = pool) {
  const result = await db.query(VIN_TELEGRAM_SQL.claim, [randomUUID()]);
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, claimToken: row.claim_token, attempts: row.attempts, status: row.status };
}

export async function loadVinTelegramDelivery(delivery, db = pool) {
  const result = await db.query(VIN_TELEGRAM_SQL.load, claimIdentity(delivery));
  const row = result.rows[0];
  if (!row) return null;
  const skipped = { stillAuthorized: false };
  const marker = row.payload?.telegramVin;
  const requestId = decimalId(row.request_id);
  // The existing message builder uses Number(id): reject unsafe ids rather than
  // send a rounded VIN request number or a link to the wrong request.
  if (!requestId || BigInt(requestId) > BigInt(Number.MAX_SAFE_INTEGER)
      || !marker || marker.version !== 1 || !['NEW_REQUEST', 'CLIENT_MESSAGE'].includes(marker.event)
      || String(row.payload.vinRequestId) !== requestId || row.request_status === 'CLOSED') return skipped;
  const chatId = decimalId(row.telegram_chat_id);
  if (row.still_authorized !== true || !chatId || row.already_sent === true
      || String(row.canonical_user_id) !== String(row.user_id)) return skipped;
  if (marker.event === 'NEW_REQUEST' && row.notification_type !== 'VIN_REQUEST_NEW') return skipped;
  if (marker.event === 'CLIENT_MESSAGE' && (row.notification_type !== 'VIN_REQUEST_UPDATED'
      || !decimalId(marker.messageId) || String(marker.messageId) !== row.message_id
      || !String(row.client_message || '').trim())) return skipped;
  return {
    stillAuthorized: true,
    chatId,
    event: marker.event,
    message: marker.event === 'CLIENT_MESSAGE' ? row.client_message : '',
    locale: row.preferred_locale === 'en' || row.preferred_locale === 'ru' ? row.preferred_locale : 'uk',
    request: {
      id: requestId, vin: row.vin, request_text: row.request_text,
      contact_phone: row.contact_phone, guest_name: row.guest_name,
      vehicle_brand_name: row.vehicle_brand_name, first_name: row.first_name,
      last_name: row.last_name, email: row.email, user_phone: row.user_phone,
    },
  };
}

export async function finishVinTelegramDelivery(delivery, outcome, db = pool) {
  if (!['SENT', 'SKIPPED', 'RETRY'].includes(outcome)) throw new Error('INVALID_VIN_DELIVERY_OUTCOME');
  const identity = claimIdentity(delivery);
  const chatId = delivery.chatId == null ? null : decimalId(delivery.chatId);
  if (delivery.chatId != null && !chatId) throw new Error('INVALID_VIN_DELIVERY_CHAT');
  const result = await db.query(VIN_TELEGRAM_SQL.finish, [...identity, outcome, chatId]);
  if (result.rows.length !== 1) throw new Error('VIN_DELIVERY_CLAIM_LOST');
  return result.rows[0].status;
}
