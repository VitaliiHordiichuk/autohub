import { pool } from "../config/db.js";

export const ReservationRepository = {
  async getReservedQuantity(
    productOfferId,
    excludeCartItemId = null,
    db = pool
  ) {
    const sql = `
      SELECT COALESCE(SUM(quantity), 0) AS reserved_quantity
      FROM stock_reservations
      WHERE product_offer_id = $1
        AND status = 'ACTIVE'
        AND (
          reserved_until IS NULL
          OR reserved_until > CURRENT_TIMESTAMP
        )
        AND (
          $2::integer IS NULL
          OR cart_item_id <> $2
        );
    `;

    const result = await db.query(sql, [
      productOfferId,
      excludeCartItemId,
    ]);

    return Number(result.rows[0].reserved_quantity);
  },

  async upsertCartReservation(
  {
    cartId,
    cartItemId,
    checkoutSessionId,
    productOfferId,
    quantity,
    reservedUntil,
  },
  db = pool
) {
  const sql = `
    INSERT INTO stock_reservations (
      cart_id,
      cart_item_id,
      checkout_session_id,
      product_offer_id,
      quantity,
      status,
      reserved_until
    )
    VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)

    ON CONFLICT (cart_item_id)
    WHERE cart_item_id IS NOT NULL
      AND status = 'ACTIVE'

    DO UPDATE SET
      checkout_session_id = EXCLUDED.checkout_session_id,
      product_offer_id = EXCLUDED.product_offer_id,
      quantity = EXCLUDED.quantity,
      reserved_until = EXCLUDED.reserved_until

    RETURNING *;
  `;

  const result = await db.query(sql, [
    cartId,
    cartItemId,
    checkoutSessionId,
    productOfferId,
    quantity,
    reservedUntil,
  ]);

  return result.rows[0];
},

  async releaseByCartItemId(cartItemId, db = pool) {
    const sql = `
      UPDATE stock_reservations
      SET
        status = 'RELEASED',
        reserved_until = CURRENT_TIMESTAMP
      WHERE cart_item_id = $1
        AND status = 'ACTIVE'
      RETURNING *;
    `;

    const result = await db.query(sql, [cartItemId]);

    return result.rows[0] ?? null;
  },
  async findActiveByCheckoutSessionId(
  checkoutSessionId,
  db = pool
) {
  const sql = `
    SELECT *
    FROM stock_reservations
    WHERE checkout_session_id = $1
      AND status = 'ACTIVE'
      AND reserved_until > CURRENT_TIMESTAMP
    ORDER BY id
    FOR UPDATE;
  `;

  const result = await db.query(sql, [checkoutSessionId]);

  return result.rows;
},

async attachToOrder(
  checkoutSessionId,
  orderId,
  db = pool
) {
  const sql = `
    UPDATE stock_reservations
    SET
      order_id = $2,
      status = 'ORDER_PENDING'
    WHERE checkout_session_id = $1
      AND status = 'ACTIVE'
    RETURNING *;
  `;

  const result = await db.query(sql, [
    checkoutSessionId,
    orderId,
  ]);

  return result.rows;
},
async findByOrderAndOfferForUpdate(
  orderId,
  productOfferId,
  db = pool
) {
  const sql = `
    SELECT *
    FROM stock_reservations
    WHERE order_id = $1
      AND product_offer_id = $2
      AND status = 'ORDER_PENDING'
    LIMIT 1
    FOR UPDATE;
  `;

  const result = await db.query(sql, [
    orderId,
    productOfferId,
  ]);

  return result.rows[0] ?? null;
},

async updateQuantity(
  reservationId,
  quantity,
  db = pool
) {
  const sql = `
    UPDATE stock_reservations
    SET quantity = $2
    WHERE id = $1
    RETURNING *;
  `;

  const result = await db.query(sql, [
    reservationId,
    quantity,
  ]);

  return result.rows[0] ?? null;
},
async cancelByOrderItem(
  orderItemId,
  db = pool
) {
const sql = `
  UPDATE stock_reservations
  SET status = 'CANCELLED'
  WHERE order_id = (
    SELECT order_id
    FROM order_items
    WHERE id = $1
  )
  AND product_offer_id = (
    SELECT product_offer_id
    FROM order_items
    WHERE id = $1
  )
  AND status = 'ORDER_PENDING'
  RETURNING *;
`;

  const result = await db.query(sql, [
    orderItemId,
  ]);

  return result.rows;
},
};