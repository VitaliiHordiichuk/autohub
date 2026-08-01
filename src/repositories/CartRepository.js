import { pool } from "../config/db.js";

export const CartRepository = {
  async createCart(
    userId = null,
    db = pool
  ) {
    const sql = `
      INSERT INTO carts (user_id)
      VALUES ($1)
      RETURNING *;
    `;

    const result =
      await db.query(sql, [userId]);

    return result.rows[0];
  },

  async findActiveCartByUserId(
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

    const result =
      await db.query(sql, [userId]);

    return result.rows[0] ?? null;
  },

  async findActiveCartById(
    cartId,
    db = pool
  ) {
    const sql = `
      SELECT *
      FROM carts
      WHERE id = $1
        AND status = 'ACTIVE'
      LIMIT 1;
    `;

    const result =
      await db.query(sql, [cartId]);

    return result.rows[0] ?? null;
  },

  async addItem(
    cartId,
    productOfferId,
    quantity,
    db = pool
  ) {
    const sql = `
      INSERT INTO cart_items (
        cart_id,
        product_offer_id,
        quantity
      )
      VALUES ($1, $2, $3)

      ON CONFLICT (
        cart_id,
        product_offer_id
      )
      DO UPDATE SET
        quantity =
          cart_items.quantity +
          EXCLUDED.quantity,
        updated_at =
          CURRENT_TIMESTAMP

      RETURNING *;
    `;

    const result = await db.query(
      sql,
      [
        cartId,
        productOfferId,
        quantity,
      ]
    );

    return result.rows[0];
  },

  async findItem(
    cartId,
    productOfferId,
    db = pool
  ) {
    const sql = `
      SELECT *
      FROM cart_items
      WHERE cart_id = $1
        AND product_offer_id = $2
      LIMIT 1;
    `;

    const result = await db.query(
      sql,
      [
        cartId,
        productOfferId,
      ]
    );

    return result.rows[0] ?? null;
  },

  async findItemById(
    cartId,
    itemId,
    db = pool
  ) {
    const sql = `
      SELECT *
      FROM cart_items
      WHERE cart_id = $1
        AND id = $2
      LIMIT 1;
    `;

    const result = await db.query(
      sql,
      [cartId, itemId]
    );

    return result.rows[0] ?? null;
  },

  async setItemQuantity(
    cartId,
    itemId,
    quantity,
    db = pool
  ) {
    const sql = `
      UPDATE cart_items
      SET
        quantity = $3,
        updated_at =
          CURRENT_TIMESTAMP
      WHERE cart_id = $1
        AND id = $2
      RETURNING *;
    `;

    const result = await db.query(
      sql,
      [
        cartId,
        itemId,
        quantity,
      ]
    );

    return result.rows[0] ?? null;
  },

  async deleteItem(
    cartId,
    itemId,
    db = pool
  ) {
    const sql = `
      DELETE FROM cart_items
      WHERE cart_id = $1
        AND id = $2
      RETURNING *;
    `;

    const result = await db.query(
      sql,
      [cartId, itemId]
    );

    return result.rows[0] ?? null;
  },

  async getItems(
    cartId,
    db = pool
  ) {
    const sql = `
      SELECT
        ci.id,
        ci.cart_id,
        ci.product_offer_id,
        ci.quantity,
        ci.created_at,
        ci.updated_at,

        p.id AS product_id,
        p.article,
        p.name,

        CASE
          WHEN po.price_mode = 'MANUAL'
            AND po.manual_retail_price
              IS NOT NULL
          THEN po.manual_retail_price
          ELSE po.retail_price
        END AS retail_price,

        po.minimum_sale_price,

        po.quantity
          AS available_quantity,
        po.source_type,
        po.is_available,
        COALESCE(po.is_returnable, w.returnable_by_default, TRUE) AS is_returnable

      FROM cart_items ci

      JOIN product_offers po
        ON po.id =
          ci.product_offer_id

      JOIN products p
        ON p.id = po.product_id

      LEFT JOIN warehouses w
        ON w.id = po.warehouse_id

      WHERE ci.cart_id = $1

      ORDER BY ci.created_at;
    `;

    const result =
      await db.query(sql, [cartId]);

    return result.rows;
  },

  async closeCart(
    cartId,
    db = pool
  ) {
    const sql = `
      UPDATE carts
      SET
        status = 'CHECKED_OUT',
        updated_at =
          CURRENT_TIMESTAMP
      WHERE id = $1
        AND status = 'ACTIVE'
      RETURNING *;
    `;

    const result =
      await db.query(sql, [cartId]);

    return result.rows[0] ?? null;
  },

  async deleteItems(cartId, itemIds, db = pool) {
    if (!Array.isArray(itemIds) || itemIds.length === 0) return [];
    const sql = `
      DELETE FROM cart_items
      WHERE cart_id = $1
        AND id = ANY($2::integer[])
      RETURNING *;
    `;
    const result = await db.query(sql, [cartId, itemIds]);
    return result.rows;
  },
};
