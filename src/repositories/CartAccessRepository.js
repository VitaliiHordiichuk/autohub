import { pool } from "../config/db.js";

export const CartAccessRepository = {
  async createForUser(userId, db = pool) {
    const sql = `
      INSERT INTO carts (
        user_id,
        guest_token_hash
      )
      VALUES ($1, NULL)
      RETURNING *;
    `;

    const result = await db.query(sql, [userId]);

    return result.rows[0];
  },

  async createForGuest(
    guestTokenHash,
    db = pool
  ) {
    const sql = `
      INSERT INTO carts (
        user_id,
        guest_token_hash
      )
      VALUES (NULL, $1)
      RETURNING *;
    `;

    const result = await db.query(sql, [
      guestTokenHash,
    ]);

    return result.rows[0];
  },

  async findActiveByUserId(
    userId,
    db = pool
  ) {
    const sql = `
      SELECT *
      FROM carts
      WHERE user_id = $1
        AND status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    const result = await db.query(sql, [userId]);

    return result.rows[0] ?? null;
  },

  async findActiveByIdAndUserId(
    cartId,
    userId,
    db = pool
  ) {
    const sql = `
      SELECT *
      FROM carts
      WHERE id = $1
        AND user_id = $2
        AND status = 'ACTIVE'
      LIMIT 1;
    `;

    const result = await db.query(sql, [
      cartId,
      userId,
    ]);

    return result.rows[0] ?? null;
  },

  async findActiveGuestByIdAndTokenHash(
    cartId,
    guestTokenHash,
    db = pool
  ) {
    const sql = `
      SELECT *
      FROM carts
      WHERE id = $1
        AND user_id IS NULL
        AND guest_token_hash = $2
        AND status = 'ACTIVE'
      LIMIT 1;
    `;

    const result = await db.query(sql, [
      cartId,
      guestTokenHash,
    ]);

    return result.rows[0] ?? null;
  },
};
