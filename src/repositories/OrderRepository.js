import { pool } from "../config/db.js";

export const OrderRepository = {
  async createOrder(
    {
      customerId = null,
      createdBy = null,
      comment = null,
      totalAmount = 0,
    },
    db = pool
  ) {
    const sql = `
      INSERT INTO orders (
        customer_id,
        status,
        total_amount,
        comment,
        created_by
      )
      VALUES ($1, 'NEW', $2, $3, $4)
      RETURNING *;
    `;

    const result = await db.query(sql, [
      customerId,
      totalAmount,
      comment,
      createdBy,
    ]);

    return result.rows[0];
  },

  async addOrderItem(
    {
      orderId,
      productId,
      productOfferId,
      quantity,
      priceAtPurchase,
    },
    db = pool
  ) {
    const sql = `
      INSERT INTO order_items (
        order_id,
        product_id,
        product_offer_id,
        quantity,
        price_at_purchase
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const result = await db.query(sql, [
      orderId,
      productId,
      productOfferId,
      quantity,
      priceAtPurchase,
    ]);

    return result.rows[0];
  },

  async addStatusHistory(
    {
      orderId,
      oldStatus = null,
      newStatus,
      changedBy = null,
      comment = null,
    },
    db = pool
  ) {
    const sql = `
      INSERT INTO order_status_history (
        order_id,
        old_status,
        new_status,
        changed_by,
        comment
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const result = await db.query(sql, [
      orderId,
      oldStatus,
      newStatus,
      changedBy,
      comment,
    ]);

    return result.rows[0];
  },
  async findAllForManager(
  {
    status = null,
    limit = 50,
    offset = 0,
  } = {},
  db = pool
) {
  const sql = `
    SELECT
      o.id,
      o.customer_id,
      o.status,
      o.total_amount,
      o.comment,
      o.created_by,
      o.created_at,
      o.updated_at,
      o.tracking_number,
      o.tracking_updated_at,
      o.edit_revision,
      o.notified_edit_revision,

      c.company_name,
      c.customer_type,

      COUNT(oi.id)::integer AS items_count,
      COALESCE(SUM(oi.quantity), 0) AS total_quantity

    FROM orders o

    LEFT JOIN customers c
      ON c.id = o.customer_id

    LEFT JOIN order_items oi
      ON oi.order_id = o.id
      AND oi.status = 'ACTIVE'

    WHERE ($1::varchar IS NULL OR o.status = $1)

    GROUP BY
      o.id,
      c.company_name,
      c.customer_type

    ORDER BY
      CASE WHEN o.status = 'NEW' THEN 0 ELSE 1 END,
      o.created_at DESC

    LIMIT $2
    OFFSET $3;
  `;

  const result = await db.query(sql, [
    status,
    limit,
    offset,
  ]);

  return result.rows;
},

async getManagerStatusCounts(db = pool) {
  const result = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'NEW')::integer AS new_count,
      COUNT(*) FILTER (WHERE status IN ('CONFIRMED', 'PROCESSING', 'READY'))::integer AS confirmed_count,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::integer AS completed_count,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')::integer AS cancelled_count,
      COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED', 'CANCELLED'))::integer AS active_count,
      COUNT(*)::integer AS all_count
    FROM orders;
  `);

  return result.rows[0];
},

async findByIdForManager(orderId, db = pool) {
  const sql = `
    SELECT
      o.id,
      o.customer_id,
      o.status,
      o.total_amount,
      o.comment,
      o.created_by,
      o.created_at,
      o.updated_at,
      o.tracking_number,
      o.tracking_updated_at,
      o.edit_revision,
      o.notified_edit_revision,

      c.company_name,
      c.customer_type,
      c.credit_limit,
      c.payment_delay_days

    FROM orders o

    LEFT JOIN customers c
      ON c.id = o.customer_id

    WHERE o.id = $1

    LIMIT 1;
  `;

  const result = await db.query(sql, [orderId]);

  return result.rows[0] ?? null;
},

async findAllForCustomerUser(userId, db = pool) {
  const result = await db.query(`
    SELECT
      o.id,
      o.status,
      o.total_amount,
      o.comment,
      o.created_at,
      o.updated_at,
      COUNT(oi.id)::integer AS items_count,
      COALESCE(SUM(oi.quantity), 0)::integer AS total_quantity
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN order_items oi
      ON oi.order_id = o.id AND oi.status = 'ACTIVE'
    WHERE c.user_id = $1
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT 100;
  `, [userId]);

  return result.rows;
},

async findByIdForCustomerUser(orderId, userId, db = pool) {
  const result = await db.query(`
    SELECT
      o.id,
      o.status,
      o.total_amount,
      o.comment,
      o.created_at,
      o.updated_at
      ,o.tracking_number
      ,o.tracking_updated_at
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = $1 AND c.user_id = $2
    LIMIT 1;
  `, [orderId, userId]);

  return result.rows[0] ?? null;
},

async findItemsByOrderId(orderId, db = pool) {
  const sql = `
    SELECT
      oi.id,
      oi.order_id,
      oi.product_id,
      oi.product_offer_id,
      oi.original_product_offer_id,
      oi.quantity,
      oi.price_at_purchase,
      oi.purchase_price_at_confirmation,
      oi.created_at,

      p.article,
      p.name,

      po.quantity AS offer_quantity,
      po.purchase_price,
      po.retail_price AS current_retail_price,
      po.delivery_days,
      po.source_type,
      po.is_available,

      w.id AS warehouse_id,
      w.name AS warehouse_name,
      w.city AS warehouse_city,

      s.id AS supplier_id,
      s.name AS supplier_name,

      sr.id AS reservation_id,
      sr.status AS reservation_status,
      sr.quantity AS reserved_quantity,
sr.reserved_until,
oi.status

    FROM order_items oi

    JOIN products p
      ON p.id = oi.product_id

    LEFT JOIN product_offers po
      ON po.id = oi.product_offer_id

    LEFT JOIN warehouses w
      ON w.id = po.warehouse_id

    LEFT JOIN suppliers s
      ON s.id = po.supplier_id

    LEFT JOIN stock_reservations sr
      ON sr.order_id = oi.order_id
     AND sr.product_offer_id = oi.product_offer_id
     AND sr.status IN ('ACTIVE', 'ORDER_PENDING')

WHERE oi.order_id = $1
AND oi.status = 'ACTIVE'
    ORDER BY oi.id;
  `;

  const result = await db.query(sql, [orderId]);

  return result.rows;
},

async findStatusHistory(orderId, db = pool) {
  const sql = `
    SELECT
      osh.id,
      osh.old_status,
      osh.new_status,
      osh.changed_by,
      osh.comment,
      osh.created_at,

      u.email AS changed_by_email

    FROM order_status_history osh

    LEFT JOIN users u
      ON u.id = osh.changed_by

    WHERE osh.order_id = $1

    ORDER BY osh.created_at;
  `;

  const result = await db.query(sql, [orderId]);

  return result.rows;
},

async findItemHistory(orderId, db = pool) {
  const sql = `
    SELECT
      oih.id,
      oih.order_item_id,
      oih.action,
      oih.old_product_offer_id,
      oih.new_product_offer_id,
      oih.old_price,
      oih.new_price,
      oih.old_quantity,
      oih.new_quantity,
      oih.changed_by,
      oih.reason,
      oih.created_at

    FROM order_item_history oih

    JOIN order_items oi
      ON oi.id = oih.order_item_id

    WHERE oi.order_id = $1

    ORDER BY oih.created_at;
  `;

  const result = await db.query(sql, [orderId]);

  return result.rows;
},
async findByIdForUpdate(orderId, db = pool) {
  const sql = `
    SELECT *
    FROM orders
    WHERE id = $1
    FOR UPDATE;
  `;

  const result = await db.query(sql, [orderId]);

  return result.rows[0] ?? null;
},
async markEditPending(orderId, db = pool) {
  const result = await db.query(`
    UPDATE orders
    SET edit_revision = edit_revision + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *;
  `, [orderId]);
  return result.rows[0] ?? null;
},

async confirmPendingEdits(orderId, changedBy, db = pool) {
  const result = await db.query(`
    UPDATE orders
    SET notified_edit_revision = edit_revision,
        edits_confirmed_at = CURRENT_TIMESTAMP,
        edits_confirmed_by = $2,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND edit_revision > notified_edit_revision
    RETURNING *;
  `, [orderId, changedBy]);
  return result.rows[0] ?? null;
},

async findItemByIdForUpdate(
  orderId,
  orderItemId,
  db = pool
) {
  const sql = `
    SELECT *
    FROM order_items
    WHERE id = $1
      AND order_id = $2
    FOR UPDATE;
  `;

  const result = await db.query(sql, [
    orderItemId,
    orderId,
  ]);

  return result.rows[0] ?? null;
},

async updateItemQuantity(
  orderItemId,
  quantity,
  db = pool
) {
  const sql = `
    UPDATE order_items
    SET quantity = $2
    WHERE id = $1
    RETURNING *;
  `;

  const result = await db.query(sql, [
    orderItemId,
    quantity,
  ]);

  return result.rows[0] ?? null;
},

async recalculateTotal(orderId, db = pool) {
  const sql = `
    UPDATE orders
    SET
      total_amount = (
        SELECT COALESCE(
          SUM(quantity * price_at_purchase),
          0
        )
        FROM order_items
WHERE order_id = $1
AND status = 'ACTIVE'
      ),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *;
  `;

  const result = await db.query(sql, [orderId]);

  return result.rows[0] ?? null;
},

async addItemHistory(
  {
    orderItemId,
    action,
    oldQuantity = null,
    newQuantity = null,
    oldPrice = null,
    newPrice = null,
    oldProductOfferId = null,
    newProductOfferId = null,
    changedBy = null,
    reason = null,
  },
  db = pool
) {
  const sql = `
    INSERT INTO order_item_history (
      order_item_id,
      action,
      old_quantity,
      new_quantity,
      old_price,
      new_price,
      old_product_offer_id,
      new_product_offer_id,
      changed_by,
      reason
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10
    )
    RETURNING *;
  `;

  const result = await db.query(sql, [
    orderItemId,
    action,
    oldQuantity,
    newQuantity,
    oldPrice,
    newPrice,
    oldProductOfferId,
    newProductOfferId,
    changedBy,
    reason,
  ]);

  return result.rows[0];
},
async updateItemPrice(
  orderItemId,
  priceAtPurchase,
  db = pool
) {
  const sql = `
    UPDATE order_items
    SET price_at_purchase = $2
    WHERE id = $1
    RETURNING *;
  `;

  const result = await db.query(sql, [
    orderItemId,
    priceAtPurchase,
  ]);

  return result.rows[0] ?? null;
},
async removeItem(
  orderItemId,
  db = pool
) {
  const sql = `
    UPDATE order_items
    SET status = 'REMOVED'
    WHERE id = $1
    RETURNING *;
  `;

  const result = await db.query(sql, [
    orderItemId,
  ]);

  return result.rows[0] ?? null;
},
async restoreItem(
  orderItemId,
  db = pool
) {
  const sql = `
    UPDATE order_items
    SET status = 'ACTIVE'
    WHERE id = $1
    RETURNING *;
  `;

  const result = await db.query(sql, [
    orderItemId,
  ]);

  return result.rows[0] ?? null;
},
async addManagerOrderItem(
  {
    orderId,
    productId,
    productOfferId,
    quantity,
    priceAtPurchase,
  },
  db = pool
) {
  const sql = `
    INSERT INTO order_items (
      order_id,
      product_id,
      product_offer_id,
      quantity,
      price_at_purchase,
      status
    )
    VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
    RETURNING *;
  `;

  const result = await db.query(sql, [
    orderId,
    productId,
    productOfferId,
    quantity,
    priceAtPurchase,
  ]);

  return result.rows[0];
},
async findActiveItemByOffer(
  orderId,
  productOfferId,
  db = pool
) {
  const sql = `
    SELECT *
    FROM order_items
    WHERE order_id = $1
      AND product_offer_id = $2
      AND status = 'ACTIVE'
    LIMIT 1;
  `;

  const result = await db.query(sql, [
    orderId,
    productOfferId,
  ]);

  return result.rows[0] ?? null;
},
async updateStatus(
  orderId,
  status,
  db = pool
) {
  const sql = `
    UPDATE orders
    SET
      status = $2,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *;
  `;

  const result = await db.query(sql, [
    orderId,
    status,
  ]);

  return result.rows[0] ?? null;
},
async confirmPurchasePrices(
  orderId,
  db = pool
) {
  const sql = `
    UPDATE order_items oi
    SET purchase_price_at_confirmation =
      po.purchase_price
    FROM product_offers po
    WHERE oi.order_id = $1
      AND oi.status = 'ACTIVE'
      AND po.id = oi.product_offer_id
    RETURNING oi.*;
  `;

  const result = await db.query(sql, [
    orderId,
  ]);

  return result.rows;
},
};
