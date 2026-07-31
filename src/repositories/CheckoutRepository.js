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
    },
    db = pool
  ) {
    const sql = `
      INSERT INTO checkout_sessions (
        cart_id,
        user_id,
        status,
        expires_at
      )
      VALUES ($1, $2, 'ACTIVE', $3)
      RETURNING *;
    `;

    const result = await db.query(sql, [
      cartId,
      userId,
      expiresAt,
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
  async findActiveById(checkoutSessionId, db = pool) {
  const sql = `
    SELECT *
    FROM checkout_sessions
    WHERE id = $1
      AND status = 'ACTIVE'
      AND expires_at > CURRENT_TIMESTAMP
    FOR UPDATE;
  `;

  const result = await db.query(sql, [checkoutSessionId]);

  return result.rows[0] ?? null;
},
};
