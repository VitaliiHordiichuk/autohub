import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { pool } from '../src/config/db.js';
import { runDataRetention } from '../src/services/DataRetentionService.js';
import { SupplierService } from '../src/services/SupplierService.js';
import { WarehouseService } from '../src/services/WarehouseService.js';
import { WarehouseImportProfileService } from '../src/services/WarehouseImportProfileService.js';
import { EmailImportFileRepository } from '../src/repositories/EmailImportFileRepository.js';
import { CartAccessService } from '../src/services/CartAccessService.js';

after(() => pool.end());
const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
const exists = async (table, id) => Boolean(await one(`SELECT id FROM ${table} WHERE id=$1`, [id]));
const execute = (options = {}) => runDataRetention({ dryRun: false, force: true, maxDurationMs: 60_000, maxBatches: 5000, ...options });

async function stream() {
  const token = randomUUID();
  const supplier = await SupplierService.createSupplier({ name: `RETENTION ${token}`, type: 'PARTNER', warehousePriorityEnabled: false });
  const warehouse = await WarehouseService.createWarehouse({ supplierId: Number(supplier.id), name: `RETENTION ${token}`, city: 'TEST', type: 'SUPPLIER', deliveryDays: 1 });
  const brand = await one('SELECT id FROM brands ORDER BY id LIMIT 1');
  const { profile } = await WarehouseImportProfileService.saveProfile(Number(warehouse.id), {
    fileType: 'CSV', brandMode: 'FIXED', fixedBrandId: Number(brand.id),
    articleColumn: 1, nameColumn: 2, priceColumn: 3, quantityColumn: 4, startRow: 1,
    isActive: true, emailAutoImportEnabled: false, newProductsMode: 'AUTO',
  });
  return { supplier, warehouse, brand, profile };
}

async function importFixture(fixture, days, status = 'COMPLETED', withProfile = true) {
  return one(`INSERT INTO imports (warehouse_id, supplier_id, warehouse_supplier_import_id, source,
    file_name, status, total_rows, success_rows, created_at)
    VALUES ($1,$2,$3,'MANUAL','retention-test.csv',$4,1,1,NOW()-($5 * INTERVAL '1 day')) RETURNING *`,
  [fixture.warehouse.id, fixture.supplier.id, withProfile ? fixture.profile.id : null, status, days]);
}

async function attachment(fixture, importId, hash = randomUUID().replaceAll('-', '').padEnd(64, '0')) {
  return EmailImportFileRepository.createCompletedReference({
    warehouseSupplierImportId: fixture.profile.id, supplierImportSettingsId: fixture.profile.supplierImportSettingsId,
    emailMessageId: randomUUID(), emailUid: 42, emailFrom: 'retention@example.test',
    emailSubject: 'test', attachmentName: 'test.csv', attachmentSha256: hash,
    importId, receivedAt: new Date(),
  });
}

test('retention keeps five reports per stream, preserves pending decisions, current offers and email deduplication', async () => {
  assert.match(process.env.DB_NAME || '', /_test$/, 'Never run against a working database');
  const fixture = await stream();
  const ids = [];
  for (let day = 10; day >= 3; day--) ids.push((await importFixture(fixture, day, day === 3 ? 'FAILED' : 'COMPLETED')).id);
  // Separate legacy/no-profile stream in the same warehouse must retain its own five.
  const legacy = [];
  for (let day = 10; day >= 5; day--) legacy.push((await importFixture(fixture, day, 'COMPLETED', false)).id);
  const rowIds = [];
  for (let index = 0; index < 8; index++) {
    rowIds.push((await one(`INSERT INTO import_rows(import_id,article,name,price,quantity,status,raw_data)
      VALUES($1,'RETENTION','Test',10,1,'IMPORTED','["original row"]'::jsonb) RETURNING id`, [ids[0]])).id);
  }
  const review = await one(`INSERT INTO import_new_products(warehouse_id,brand_id,article,article_normalized,name,
    price,quantity,status,first_import_id,latest_import_id,latest_import_row_id)
    VALUES($1,$2,$3,$3,'Manual review',10,2,'PENDING',$4,$4,$5) RETURNING id`,
  [fixture.warehouse.id, fixture.brand.id, randomUUID(), ids[0], rowIds[0]]);
  const email = await attachment(fixture, ids[0]);
  await pool.query("UPDATE email_import_files SET created_at=NOW()-INTERVAL '91 days',processed_at=NOW()-INTERVAL '91 days' WHERE id=$1", [email.id]);
  const offersBefore = await one('SELECT count(*) AS count, sum(purchase_price) AS prices FROM product_offers');
  const dry = await runDataRetention();
  assert.equal(dry.status, 'DRY_RUN');
  assert.ok(dry.candidates.imports >= 4);
  assert.ok(await exists('imports', ids[0]), 'dry run must not delete');
  assert.ok(await exists('import_rows', rowIds[0]));

  // Force an interrupted/partial run, then resume. A report may contain many rows.
  const partial = await execute({ batchSize: 2, maxBatches: 11 });
  assert.equal(partial.status, 'PARTIAL');
  let result;
  for (let attempt = 0; attempt < 30; attempt++) {
    result = await execute();
    if (result.status === 'COMPLETED') break;
  }
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual((await pool.query('SELECT id FROM imports WHERE warehouse_id=$1 AND warehouse_supplier_import_id=$2 ORDER BY id',
    [fixture.warehouse.id, fixture.profile.id])).rows.map(row => row.id), ids.slice(-5));
  assert.deepEqual((await pool.query('SELECT id FROM imports WHERE warehouse_id=$1 AND warehouse_supplier_import_id IS NULL ORDER BY id',
    [fixture.warehouse.id])).rows.map(row => row.id), legacy.slice(-5));
  assert.equal(await exists('import_rows', rowIds[0]), false);
  const pending = await one('SELECT * FROM import_new_products WHERE id=$1', [review.id]);
  assert.equal(pending.status, 'PENDING');
  assert.equal(Number(pending.price), 10);
  assert.equal(pending.latest_import_row_id, null);
  assert.equal(pending.latest_import_id, null);
  assert.deepEqual(await one('SELECT count(*) AS count, sum(purchase_price) AS prices FROM product_offers'), offersBefore);
  const duplicate = await EmailImportFileRepository.findCompletedByHash({ warehouseSupplierImportId: fixture.profile.id, attachmentSha256: email.attachment_sha256 });
  assert.ok(duplicate, 'dedup must survive report removal');
  assert.equal(duplicate.import_id, null);
  assert.equal(duplicate.has_successful_import, true);
  assert.equal(duplicate.email_from, null);
  assert.equal(duplicate.email_subject, null);
  assert.equal(duplicate.attachment_name, '[archived]');
  const reference = await EmailImportFileRepository.createCompletedReference({
    warehouseSupplierImportId: fixture.profile.id, supplierImportSettingsId: fixture.profile.supplierImportSettingsId,
    emailMessageId: randomUUID(), emailUid: 43, attachmentName: 'duplicate.csv', attachmentSha256: email.attachment_sha256,
    importId: ids[0], hasSuccessfulImport: true, // report disappeared after duplicate lookup
  });
  assert.equal(reference.has_successful_import, true);
  assert.equal(reference.import_id, null);
  assert.equal((await runDataRetention({ dryRun: false })).status, 'NOT_DUE', 'checkpoint survives process restarts');
  const repeat = await execute();
  assert.equal(repeat.status, 'COMPLETED');
  assert.equal(Object.values(repeat.deleted).reduce((sum, n) => sum + n, 0), 0);
});

test('active imports and email processing are protected, failed zero-row files are not successful duplicates', async () => {
  const fixture = await stream();
  const ids = [];
  for (let day = 10; day >= 4; day--) ids.push((await importFixture(fixture, day)).id);
  const active = await importFixture(fixture, 0, 'PROCESSING');
  await execute();
  assert.ok(await exists('imports', ids[0]));
  await pool.query("UPDATE imports SET status='FAILED' WHERE id=$1", [active.id]);
  const email = await EmailImportFileRepository.createProcessing({
    warehouseSupplierImportId: fixture.profile.id, supplierImportSettingsId: fixture.profile.supplierImportSettingsId,
    emailMessageId: randomUUID(), emailUid: 44, attachmentName: 'busy.csv', attachmentSha256: 'b'.repeat(64),
  });
  await execute();
  assert.ok(await exists('imports', ids[0]));
  await EmailImportFileRepository.markFailed({ id: email.id, errorMessage: 'test retry' });
  await pool.query('UPDATE imports SET success_rows=0 WHERE id=$1', [ids[0]]);
  const zero = await attachment(fixture, ids[0]);
  assert.equal(zero.has_successful_import, false);
  await pool.query('UPDATE imports SET success_rows=NULL WHERE id=$1', [ids[1]]);
  const legacyNull = await attachment(fixture, ids[1]);
  await execute();
  assert.equal(await exists('imports', ids[0]), false);
  assert.equal(await EmailImportFileRepository.findCompletedByHash({ warehouseSupplierImportId: fixture.profile.id, attachmentSha256: zero.attachment_sha256 }), null);
  assert.equal(await EmailImportFileRepository.findCompletedByHash({ warehouseSupplierImportId: fixture.profile.id, attachmentSha256: legacyNull.attachment_sha256 }), null);
  assert.equal((await one('SELECT status FROM email_import_files WHERE id=$1', [email.id])).status, 'FAILED', 'retry state is not erased');
});

test('retention removes only expired histories and tokens, never current prices or customer pricing decisions', async () => {
  const user = await one('SELECT id FROM users ORDER BY id LIMIT 1');
  const customer = await one('SELECT id FROM customers ORDER BY id LIMIT 1');
  const offer = await one('SELECT * FROM product_offers ORDER BY id LIMIT 1');
  const search = async days => one(`INSERT INTO search_events(raw_query,found,created_at) VALUES('retention',false,NOW()-($1 * INTERVAL '1 day')) RETURNING id`, [days]);
  const oldSearch = await search(31), freshSearch = await search(29);
  const child = await one(`INSERT INTO search_event_results(search_event_id,relation_type,article) VALUES($1,'EXACT','retention') RETURNING id`, [oldSearch.id]);
  const funnel = async days => one(`INSERT INTO funnel_events(event_type,visitor_session_id,created_at)
    VALUES('PRODUCT_VIEW','retention-funnel',NOW()-($1 * INTERVAL '1 day')) RETURNING id`, [days]);
  const oldFunnel = await funnel(31), freshFunnel = await funnel(29);
  const price = async days => one(`INSERT INTO price_history(product_id,product_offer_id,old_price,new_price,created_at)
    VALUES($1,$2,10,20,NOW()-($3 * INTERVAL '1 day')) RETURNING id`, [offer.product_id, offer.id, days]);
  const oldPrice = await price(91), freshPrice = await price(89);
  const notification = async (days, readDays) => one(`INSERT INTO user_notifications(user_id,event_key,type,created_at,read_at)
    VALUES($1,$2,'TEST',NOW()-($3 * INTERVAL '1 day'),CASE WHEN $4::int IS NULL THEN NULL ELSE NOW()-($4 * INTERVAL '1 day') END) RETURNING id`,
  [user.id, randomUUID(), days, readDays]);
  const oldRead = await notification(100, 31), newlyRead = await notification(100, 1);
  const oldUnread = await notification(91, null), freshUnread = await notification(89, null);
  const activity = async (type, days) => one(`INSERT INTO customer_history(customer_id,type,description,created_at)
    VALUES($1,$2,'retention test',NOW()-($3 * INTERVAL '1 day')) RETURNING id`, [customer.id, type, days]);
  const login = await activity('LOGIN', 31), freshLogin = await activity('LOGIN', 29);
  const security = await activity('PASSWORD_RESET_REQUESTED', 91), decision = await activity('PRICE_GROUP_CHANGED', 400);
  const token = async (expiry, used) => one(`INSERT INTO password_reset_tokens(user_id,token_hash,expires_at,used_at)
    VALUES($1,$2,NOW()-($3 * INTERVAL '1 day'),CASE WHEN $4::int IS NULL THEN NULL ELSE NOW()-($4 * INTERVAL '1 day') END) RETURNING id`,
  [user.id, randomUUID().replaceAll('-', '').padEnd(64, '0'), expiry, used]);
  const expired = await token(8, null), valid = await token(-1, null), used = await token(-1, 8), justExpired = await token(1, null);
  await execute();
  for (const [table, row] of [['search_events', oldSearch], ['search_event_results', child], ['funnel_events', oldFunnel], ['price_history', oldPrice],
    ['user_notifications', oldRead], ['user_notifications', oldUnread], ['customer_history', login], ['customer_history', security],
    ['password_reset_tokens', expired], ['password_reset_tokens', used]]) assert.equal(await exists(table, row.id), false, table);
  for (const [table, row] of [['search_events', freshSearch], ['funnel_events', freshFunnel], ['price_history', freshPrice], ['user_notifications', newlyRead],
    ['user_notifications', freshUnread], ['customer_history', freshLogin], ['customer_history', decision],
    ['password_reset_tokens', valid], ['password_reset_tokens', justExpired]]) assert.ok(await exists(table, row.id), table);
  assert.deepEqual(await one('SELECT * FROM product_offers WHERE id=$1', [offer.id]), offer);
});

test('retention preserves active, registered and completed-order carts; guest activity refresh is throttled', async () => {
  const user = await one('SELECT id FROM users ORDER BY id LIMIT 1');
  const offer = await one('SELECT id FROM product_offers ORDER BY id LIMIT 1');
  const guestToken = randomUUID();
  const cart = async (userId = null, token = randomUUID()) => one(`INSERT INTO carts(user_id,guest_token_hash,created_at,updated_at)
    VALUES($1,$2,NOW()-INTERVAL '40 days',NOW()-INTERVAL '40 days') RETURNING id`, [userId, userId ? null : createHash('sha256').update(token).digest('hex')]);
  const abandoned = await cart(), registered = await cart(user.id), active = await cart(), ordered = await cart(), touched = await cart(null, guestToken);
  const checkout = async (cartId, status, expiryDays) => one(`INSERT INTO checkout_sessions(cart_id,status,expires_at,created_at,updated_at)
    VALUES($1,$2,NOW()-($3 * INTERVAL '1 day'),NOW()-INTERVAL '40 days',NOW()-INTERVAL '40 days') RETURNING id`, [cartId, status, expiryDays]);
  const expired = await checkout(abandoned.id, 'EXPIRED', 39);
  await checkout(ordered.id, 'COMPLETED', 39);
  const ongoing = await checkout(active.id, 'ACTIVE', -1);
  await one(`INSERT INTO stock_reservations(cart_id,checkout_session_id,product_offer_id,quantity,status,reserved_until)
    VALUES($1,$2,$3,1,'ACTIVE',NOW()+INTERVAL '1 day') RETURNING id`, [active.id, ongoing.id, offer.id]);
  const linked = await cart();
  const linkedCheckout = await checkout(linked.id, 'EXPIRED', 39);
  const order = await one("INSERT INTO orders(comment) VALUES('Retention protected order') RETURNING id");
  const orderReservation = await one(`INSERT INTO stock_reservations(cart_id,checkout_session_id,product_offer_id,order_id,quantity,status,reserved_until)
    VALUES($1,$2,$3,$4,1,'CANCELLED',NOW()-INTERVAL '39 days') RETURNING id`, [linked.id, linkedCheckout.id, offer.id, order.id]);
  const unlimited = await cart();
  await one(`INSERT INTO stock_reservations(cart_id,product_offer_id,quantity,status,reserved_until)
    VALUES($1,$2,1,'ACTIVE',NULL) RETURNING id`, [unlimited.id, offer.id]);
  await CartAccessService.assertAccess({ cartId: touched.id, guestToken, db: pool });
  const activity = await one('SELECT updated_at FROM carts WHERE id=$1', [touched.id]);
  await CartAccessService.assertAccess({ cartId: touched.id, guestToken, db: pool });
  assert.deepEqual(await one('SELECT updated_at FROM carts WHERE id=$1', [touched.id]), activity);
  await execute();
  assert.equal(await exists('checkout_sessions', expired.id), false);
  assert.equal(await exists('carts', abandoned.id), false);
  for (const row of [registered, active, ordered, touched, linked, unlimited]) assert.ok(await exists('carts', row.id));
  assert.ok(await exists('checkout_sessions', ongoing.id));
  assert.ok(await exists('checkout_sessions', linkedCheckout.id));
  assert.ok(await exists('stock_reservations', orderReservation.id));
  assert.ok(await exists('orders', order.id));
});

test('failed batch rolls back and releases its lock so a later run can finish', async () => {
  let injected = false;
  const dbPool = { connect: async () => {
    const client = await pool.connect();
    return {
      query(sql, values) {
        if (!injected && sql.includes('DELETE FROM price_history')) {
          injected = true;
          throw new Error('simulated transient failure');
        }
        return client.query(sql, values);
      },
      release(error) { client.release(error); },
    };
  } };
  await assert.rejects(execute({ dbPool }), /simulated transient failure/);
  assert.equal((await one("SELECT status FROM data_retention_state WHERE job_name='data-retention-v1'")).status, 'FAILED');
  assert.equal((await execute()).status, 'COMPLETED');
});

test('database advisory lock prevents multiple server processes from cleaning simultaneously', async () => {
  const other = await pool.connect();
  try {
    await other.query('SELECT pg_advisory_lock(741002,1)');
    assert.equal((await execute()).status, 'ALREADY_RUNNING');
  } finally {
    await other.query('SELECT pg_advisory_unlock(741002,1)');
    other.release();
  }
});
