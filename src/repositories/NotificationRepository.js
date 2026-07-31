import { pool } from "../config/db.js";

export const NotificationRepository = {
  async createForUser({ userId, eventKey, type, orderId = null, payload = {} }, db = pool) {
    const result = await db.query(`
      INSERT INTO user_notifications(user_id, event_key, type, order_id, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (user_id, event_key) DO NOTHING
      RETURNING *;
    `, [userId, eventKey, type, orderId, JSON.stringify(payload)]);
    return result.rows[0] ?? null;
  },

  async createForStaff({ eventKey, type, orderId = null, payload = {} }, db = pool) {
    const result = await db.query(`
      INSERT INTO user_notifications(user_id, event_key, type, order_id, payload)
      SELECT u.id, $1 || ':' || u.id, $2, $3, $4::jsonb
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.is_active = TRUE
        AND r.name IN ('ADMIN', 'MANAGER')
      ON CONFLICT (user_id, event_key) DO NOTHING
      RETURNING *;
    `, [eventKey, type, orderId, JSON.stringify(payload)]);
    return result.rows;
  },

  async listForUser(userId, limit = 50, db = pool) {
    const result = await db.query(`
      SELECT id, type, order_id, payload, read_at, created_at
      FROM user_notifications
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2;
    `, [userId, limit]);
    return result.rows;
  },

  async unreadCount(userId, db = pool) {
    const result = await db.query(`
      SELECT COUNT(*)::integer AS count
      FROM user_notifications
      WHERE user_id = $1 AND read_at IS NULL;
    `, [userId]);
    return Number(result.rows[0]?.count || 0);
  },

  async markAllRead(userId, db = pool) {
    const result = await db.query(`
      UPDATE user_notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND read_at IS NULL
      RETURNING id;
    `, [userId]);
    return result.rows.length;
  },
};
