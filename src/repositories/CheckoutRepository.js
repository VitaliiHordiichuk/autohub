import { pool } from "../config/db.js";

export const CheckoutRepository = {
  async expireActiveSessionsForCart(cartId, db = pool) {
    const sql = `
      UPDATE checkout_sessions
      SET
        status = 'EXPIRED',
        updated_at = CURRENT_TIMESTAMP
      WHERE cart_id = $1
        AND status = 'ACTIVE'
        AND expires_at <= CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await db.query(sql, [cartId]);

    return result.rows;
  },

  async findActiveByCartId(cartId, db = pool) {
    const sql = `
      SELECT *
      FROM checkout_sessions
      WHERE cart_id = $1
        AND status = 'ACTIVE'
        AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1;
    `;

    const result = await db.query(sql, [cartId]);

    return result.rows[0] ?? null;
  },

  async cancelActiveForCart(cartId, db = pool) {
    const sql = `
      UPDATE checkout_sessions
      SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE cart_id = $1 AND status = 'ACTIVE'
      RETURNING *;
    `;
    const result = await db.query(sql, [cartId]);
    return result.rows;
  },

  async createSession(
    {
      cartId,
      userId = null,
      expiresAt,
      inventoryModel = "LEGACY_RESERVATION",
    },
    db = pool
  ) {
    const sql = `
      INSERT INTO checkout_sessions (
        cart_id,
        user_id,
        status,
        expires_at,
        inventory_model
      )
      VALUES ($1, $2, 'ACTIVE', $3, $4)
      RETURNING *;
    `;

    const result = await db.query(sql, [
      cartId,
      userId,
      expiresAt,
      inventoryModel,
    ]);

    return result.rows[0];
  },

  async markCompleted(checkoutSessionId, db = pool) {
    const sql = `
      UPDATE checkout_sessions
      SET
        status = 'COMPLETED',
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND status = 'ACTIVE'
      RETURNING *;
    `;

    const result = await db.query(sql, [
      checkoutSessionId,
    ]);

    return result.rows[0] ?? null;
  },

  async markCancelled(checkoutSessionId, db = pool) {
    const sql = `
      UPDATE checkout_sessions
      SET
        status = 'CANCELLED',
        cancelled_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND status = 'ACTIVE'
      RETURNING *;
    `;

    const result = await db.query(sql, [
      checkoutSessionId,
    ]);

    return result.rows[0] ?? null;
  },
  async findById(checkoutSessionId, db = pool) {
    const sql = `
      SELECT *
      FROM checkout_sessions
      WHERE id = $1
      LIMIT 1;
    `;

    const result = await db.query(sql, [checkoutSessionId]);

    return result.rows[0] ?? null;
  },

  async findActiveById(checkoutSessionId, db = pool) {
  const sql = `
    SELECT *
    FROM checkout_sessions
    WHERE id = $1
      AND status = 'ACTIVE'
      AND (
        inventory_model = 'COMMIT_ON_SUBMIT'
        OR expires_at > CURRENT_TIMESTAMP
      )
    FOR UPDATE;
  `;

  const result = await db.query(sql, [checkoutSessionId]);

  return result.rows[0] ?? null;
},
  async findByIdForUpdate(checkoutSessionId, db = pool) {
    const result = await db.query(`
      SELECT * FROM checkout_sessions
      WHERE id = $1
      FOR UPDATE;
    `, [checkoutSessionId]);
    return result.rows[0] ?? null;
  },

  async replaceSessionItems(checkoutSessionId, items, db = pool) {
    await db.query(
      `DELETE FROM checkout_session_items WHERE checkout_session_id = $1`,
      [checkoutSessionId]
    );

    const rows = [];
    for (const item of items) {
      const result = await db.query(`
        INSERT INTO checkout_session_items (
          checkout_session_id, cart_item_id, product_offer_id,
          quantity, price_snapshot, fulfillment_type,
          product_name_snapshot, article_snapshot
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *;
      `, [
        checkoutSessionId,
        item.cartItemId,
        item.productOfferId,
        item.quantity,
        item.priceSnapshot,
        item.fulfillmentType,
        item.productName,
        item.article,
      ]);
      rows.push(result.rows[0]);
    }
    return rows;
  },

  async findSessionItemsForUpdate(checkoutSessionId, db = pool) {
    const result = await db.query(`
      SELECT * FROM checkout_session_items
      WHERE checkout_session_id = $1
      ORDER BY product_offer_id, id
      FOR UPDATE;
    `, [checkoutSessionId]);
    return result.rows;
  },

  async bindIdempotencyKey(checkoutSessionId, idempotencyKey, db = pool) {
    const result = await db.query(`
      UPDATE checkout_sessions
      SET idempotency_key = COALESCE(idempotency_key, $2),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND (idempotency_key IS NULL OR idempotency_key = $2)
      RETURNING *;
    `, [checkoutSessionId, idempotencyKey]);
    return result.rows[0] ?? null;
  },

  async linkOrder(checkoutSessionId, orderId, fulfillmentType, db = pool) {
    const result = await db.query(`
      INSERT INTO checkout_session_orders (
        checkout_session_id, order_id, fulfillment_type
      ) VALUES ($1,$2,$3)
      ON CONFLICT (checkout_session_id, fulfillment_type)
      DO UPDATE SET order_id = EXCLUDED.order_id
      RETURNING *;
    `, [checkoutSessionId, orderId, fulfillmentType]);
    return result.rows[0];
  },

  async findLinkedOrders(checkoutSessionId, db = pool) {
    const result = await db.query(`
      SELECT o.*, cso.fulfillment_type AS checkout_fulfillment_type
      FROM checkout_session_orders cso
      JOIN orders o ON o.id = cso.order_id
      WHERE cso.checkout_session_id = $1
      ORDER BY CASE cso.fulfillment_type WHEN 'STOCK' THEN 0 ELSE 1 END;
    `, [checkoutSessionId]);
    return result.rows;
  },

  async markCommitCompleted(checkoutSessionId, db = pool) {
    const result = await db.query(`
      UPDATE checkout_sessions
      SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP,
          submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'ACTIVE'
      RETURNING *;
    `, [checkoutSessionId]);
    return result.rows[0] ?? null;
  },
};
