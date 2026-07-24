import { pool } from "../config/db.js";

export const CustomerRepository = {
  async findActiveByUserId(
    userId,
    db = pool
  ) {
    const sql = `
      SELECT *
      FROM customers
      WHERE user_id = $1
        AND is_active = TRUE
      LIMIT 1;
    `;

    const result = await db.query(sql, [userId]);

    return result.rows[0] ?? null;
  },
};
