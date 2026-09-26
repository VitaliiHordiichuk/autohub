import { pool } from "../config/db.js";

function productId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Некорректный productId");
  }
  return parsed;
}

export const ProductPublicUpdateService = {
  async touch(id, db = pool) {
    const result = await db.query(`
      UPDATE products
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING updated_at
    `, [productId(id)]);

    return result.rows[0]?.updated_at || null;
  },
};
