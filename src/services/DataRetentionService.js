import { pool } from '../config/db.js';

export const RETENTION_POLICY = Object.freeze({
  importsPerProfile: 5, searchDays: 30, funnelDays: 30, priceDays: 90,
  readNotificationDays: 30, unreadNotificationDays: 90,
  loginDays: 30, securityDays: 90, expiredTokenDays: 7, abandonedCartDays: 30,
});

const JOB = 'data-retention-v1';
const LOCK = [741002, 1];
const terminalImports = "('COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED')";
// Keep the newest five terminal attempts per stream, including failed attempts.
// A grace period and active-import guards protect the final email-import handoff.
const oldImports = `WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY warehouse_id, warehouse_supplier_import_id
    ORDER BY created_at DESC, id DESC) AS position
  FROM imports WHERE status IN ${terminalImports}
)
SELECT i.id FROM imports i JOIN ranked r ON r.id=i.id
WHERE r.position > ${RETENTION_POLICY.importsPerProfile}
  AND i.created_at < $1::timestamptz - INTERVAL '1 hour'
  AND NOT EXISTS (SELECT 1 FROM imports active WHERE active.status='PROCESSING'
    AND active.warehouse_id=i.warehouse_id
    AND active.warehouse_supplier_import_id IS NOT DISTINCT FROM i.warehouse_supplier_import_id)
  AND NOT EXISTS (SELECT 1 FROM email_import_files e WHERE e.status='PROCESSING'
    AND e.warehouse_supplier_import_id=i.warehouse_supplier_import_id)`;

const age = (column, days) => `${column} < $1::timestamptz - INTERVAL '${days} days'`;
const compactEmail = `t.status='COMPLETED' AND t.import_id IS NULL
  AND ${age('GREATEST(t.created_at,t.processed_at)', 90)}
  AND (t.email_from IS NOT NULL OR t.email_subject IS NOT NULL OR t.error_message IS NOT NULL
    OR t.attachment_name <> '[archived]')`;
// Unknown reservation statuses are protected as well as all order-linked rows.
const disposableReservation = (alias) => `${alias}.order_id IS NULL
  AND ${alias}.status IN ('ACTIVE', 'RELEASED', 'CANCELLED')
  AND ${age(`${alias}.reserved_until`, RETENTION_POLICY.abandonedCartDays)}`;

const abandonedCheckout = `t.status IN ('ACTIVE', 'EXPIRED', 'CANCELLED')
  AND ${age('GREATEST(t.updated_at, t.expires_at)', RETENTION_POLICY.abandonedCartDays)}
  AND NOT EXISTS (SELECT 1 FROM stock_reservations sr WHERE sr.checkout_session_id=t.id
    AND NOT ((${disposableReservation('sr')}) IS TRUE))`;

const abandonedCart = `t.user_id IS NULL
  AND ${age('t.updated_at', RETENTION_POLICY.abandonedCartDays)}
  AND NOT EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id=t.id
    AND ci.updated_at >= $1::timestamptz - INTERVAL '${RETENTION_POLICY.abandonedCartDays} days')
  AND NOT EXISTS (SELECT 1 FROM checkout_sessions cs WHERE cs.cart_id=t.id
    AND (cs.status='COMPLETED' OR GREATEST(cs.updated_at, cs.expires_at)
      >= $1::timestamptz - INTERVAL '${RETENTION_POLICY.abandonedCartDays} days'))
  AND NOT EXISTS (SELECT 1 FROM stock_reservations sr WHERE
    (sr.cart_id=t.id OR sr.cart_item_id IN (SELECT id FROM cart_items WHERE cart_id=t.id)
      OR sr.checkout_session_id IN (SELECT id FROM checkout_sessions WHERE cart_id=t.id))
    AND NOT ((${disposableReservation('sr')}) IS TRUE))`;

// Static allowlist: business tables (orders, products, manual overrides, VIN,
// stock movements and review decisions) are deliberately absent.
const rules = [
  ['search_events', age('t.created_at', RETENTION_POLICY.searchDays)],
  ['funnel_events', age('t.created_at', RETENTION_POLICY.funnelDays)],
  ['price_history', age('t.created_at', RETENTION_POLICY.priceDays)],
  ['user_notifications', `(t.read_at IS NOT NULL AND ${age('t.read_at', RETENTION_POLICY.readNotificationDays)})
    OR (t.read_at IS NULL AND ${age('t.created_at', RETENTION_POLICY.unreadNotificationDays)})`],
  ['customer_history', `(t.type='LOGIN' AND ${age('t.created_at', RETENTION_POLICY.loginDays)})
    OR (t.type IN ('PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED',
      'TEMPORARY_PASSWORD_CHANGED', 'PASSWORD_RESET_BY_STAFF')
      AND ${age('t.created_at', RETENTION_POLICY.securityDays)})`],
  ['password_reset_requests', age('t.created_at', RETENTION_POLICY.securityDays)],
  ['password_reset_tokens', `(${age('t.expires_at', RETENTION_POLICY.expiredTokenDays)})
    OR (${age('t.used_at', RETENTION_POLICY.expiredTokenDays)})`],
  ['telegram_link_tokens', age('t.expires_at', RETENTION_POLICY.expiredTokenDays)],
  ['checkout_sessions', abandonedCheckout],
  ['stock_reservations', disposableReservation('t')],
  ['carts', abandonedCart],
];

function positiveInteger(value, name, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

async function transaction(db, fn) {
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL lock_timeout='2s'");
    await db.query("SET LOCAL statement_timeout='15s'");
    const result = await fn();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function report(db, now) {
  await db.query('BEGIN READ ONLY');
  try {
    await db.query("SET LOCAL statement_timeout='15s'");
    const counts = {};
    counts.imports = Number((await db.query(`SELECT count(*) FROM (${oldImports}) old`, [now])).rows[0].count);
    counts.import_rows = Number((await db.query(`SELECT count(*) FROM import_rows WHERE import_id IN (${oldImports})`, [now])).rows[0].count);
    for (const [table, predicate] of rules) {
      counts[table] = Number((await db.query(`SELECT count(*) FROM ${table} t WHERE ${predicate}`, [now])).rows[0].count);
    }
    counts.search_event_results = Number((await db.query(`SELECT count(*) FROM search_event_results r
      JOIN search_events t ON t.id=r.search_event_id WHERE ${rules[0][1]}`, [now])).rows[0].count);
    counts.email_metadata_to_compact = Number((await db.query(`SELECT count(*) FROM email_import_files t WHERE ${compactEmail}`, [now])).rows[0].count);
    const state = (await db.query('SELECT * FROM data_retention_state WHERE job_name=$1', [JOB])).rows[0] || null;
    const autovacuumEnabled = (await db.query("SELECT setting='on' AS enabled FROM pg_settings WHERE name='autovacuum'")).rows[0]?.enabled;
    await db.query('COMMIT');
    return { status: 'DRY_RUN', policy: RETENTION_POLICY, candidates: counts, state, autovacuumEnabled };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function pruneImportBatch(db, now, batchSize) {
  return transaction(db, async () => {
    const selected = (await db.query(`SELECT i.id FROM imports i WHERE i.id IN (${oldImports})
      ORDER BY i.created_at, i.id LIMIT 1 FOR UPDATE OF i SKIP LOCKED`, [now])).rows[0];
    if (!selected) return { done: true };
    // Detach only report links; pending/rejected review records remain intact.
    const rows = await db.query(`DELETE FROM import_rows WHERE id IN (
      SELECT id FROM import_rows WHERE import_id=$1 ORDER BY id LIMIT $2
    ) RETURNING id`, [selected.id, batchSize]);
    const remains = (await db.query('SELECT 1 FROM import_rows WHERE import_id=$1 LIMIT 1', [selected.id])).rowCount;
    if (remains) return { import_rows: rows.rowCount };
    // Snapshot success before ON DELETE SET NULL removes the report reference.
    await db.query(`UPDATE email_import_files e SET has_successful_import =
      (e.status='COMPLETED' AND i.status IN ('COMPLETED','COMPLETED_WITH_ERRORS') AND COALESCE(i.success_rows,0)>0)
      FROM imports i WHERE e.import_id=i.id AND i.id=$1`, [selected.id]);
    await db.query('DELETE FROM imports WHERE id=$1', [selected.id]);
    return { import_rows: rows.rowCount, imports: 1 };
  });
}

async function deleteBatch(db, table, predicate, now, batchSize) {
  return transaction(db, async () => {
    const result = await db.query(`WITH victims AS (
      SELECT t.id FROM ${table} t WHERE ${predicate}
      ORDER BY t.id LIMIT $2 FOR UPDATE OF t SKIP LOCKED
    ) DELETE FROM ${table} t USING victims v WHERE t.id=v.id RETURNING t.id`, [now, batchSize]);
    return result.rowCount;
  });
}

/** Dry-run by default. The scheduler explicitly opts into writes after migration 077. */
export async function runDataRetention({
  dbPool = pool, dryRun = true, force = false,
  batchSize = 500, maxBatches = 400, maxDurationMs = 30_000,
} = {}) {
  positiveInteger(batchSize, 'batchSize', 2000);
  positiveInteger(maxBatches, 'maxBatches', 10_000);
  positiveInteger(maxDurationMs, 'maxDurationMs', 60_000);
  const db = await dbPool.connect();
  let locked = false;
  try {
    const ready = (await db.query("SELECT to_regclass('public.data_retention_state') IS NOT NULL AS ready")).rows[0].ready;
    if (!ready) return { status: 'MIGRATION_REQUIRED', migration: '077_add_automatic_data_retention' };
    const now = (await db.query('SELECT CURRENT_TIMESTAMP AS now')).rows[0].now;
    if (dryRun) return await report(db, now);
    locked = (await db.query('SELECT pg_try_advisory_lock($1,$2) AS locked', LOCK)).rows[0].locked;
    if (!locked) return { status: 'ALREADY_RUNNING' };
    const state = (await db.query('SELECT last_completed_at FROM data_retention_state WHERE job_name=$1', [JOB])).rows[0];
    if (!force && state?.last_completed_at && now - new Date(state.last_completed_at) < 86_400_000) {
      return { status: 'NOT_DUE' };
    }
    await db.query(`INSERT INTO data_retention_state(job_name,last_attempt_at,status)
      VALUES ($1,$2,'RUNNING') ON CONFLICT(job_name) DO UPDATE
      SET last_attempt_at=$2,status='RUNNING',last_error=NULL`, [JOB, now]);
    const deleted = {};
    let compactedEmailMetadata = 0;
    let batches = 0;
    let pending = false;
    const deadline = Date.now() + maxDurationMs;
    const stageBatchLimit = Math.max(1, Math.floor(maxBatches / (rules.length + 2)));
    // Per-stage cap prevents a large first cleanup from starving other histories.
    for (const stage of ['imports', ...rules, 'email_metadata']) {
      let done = false;
      for (let index = 0; index < stageBatchLimit && Date.now() < deadline; index++) {
        batches++;
        if (stage === 'imports') {
          const result = await pruneImportBatch(db, now, batchSize);
          if (result.done) { done = true; break; }
          for (const [key, count] of Object.entries(result)) deleted[key] = (deleted[key] || 0) + count;
        } else if (stage === 'email_metadata') {
          const count = await transaction(db, async () => (await db.query(`WITH victims AS (
            SELECT t.id FROM email_import_files t WHERE ${compactEmail}
            ORDER BY t.id LIMIT $2 FOR UPDATE OF t SKIP LOCKED
          ) UPDATE email_import_files t SET email_from=NULL,email_subject=NULL,
              error_message=NULL,attachment_name='[archived]'
            FROM victims v WHERE t.id=v.id RETURNING t.id`, [now, batchSize])).rowCount);
          compactedEmailMetadata += count;
          if (count < batchSize) { done = true; break; }
        } else {
          const [table, predicate] = stage;
          const count = await deleteBatch(db, table, predicate, now, batchSize);
          deleted[table] = (deleted[table] || 0) + count;
          if (count < batchSize) { done = true; break; }
        }
      }
      if (!done) pending = true;
    }
    const result = { status: pending ? 'PARTIAL' : 'COMPLETED', deleted, compactedEmailMetadata, batches };
    await db.query(`UPDATE data_retention_state SET status=$2,summary=$3::jsonb,last_error=NULL,
      last_completed_at=CASE WHEN $2='COMPLETED' THEN $4 ELSE last_completed_at END
      WHERE job_name=$1`, [JOB, result.status, JSON.stringify(result), now]);
    return result;
  } catch (error) {
    if (locked) await db.query(`UPDATE data_retention_state SET status='FAILED',last_error=$2
      WHERE job_name=$1`, [JOB, String(error.message).slice(0, 2000)]).catch(() => {});
    throw error;
  } finally {
    let discardConnection = false;
    if (locked) {
      try { await db.query('SELECT pg_advisory_unlock($1,$2)', LOCK); }
      catch { discardConnection = true; }
    }
    // Never return a possibly advisory-locked connection to the shared pool.
    db.release(discardConnection);
  }
}
