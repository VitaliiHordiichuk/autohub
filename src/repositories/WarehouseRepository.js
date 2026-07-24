import { pool } from "../config/db.js";

export const WarehouseRepository = {
  async create(
    {
      organizationId = null,
      supplierId = null,
      name,
      city = null,
      type,
      deliveryDays = 0,
      pickupAvailable = false,
      shippingAvailable = true,
      priority = null,
    },
    db = pool
  ) {
    const sql = `
      INSERT INTO warehouses (
        organization_id,
        supplier_id,
        name,
        city,
        type,
        delivery_days,
        pickup_available,
        shipping_available,
        priority,
        is_active,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        TRUE,
        CURRENT_TIMESTAMP
      )
      RETURNING *;
    `;

    const result = await db.query(sql, [
      organizationId,
      supplierId,
      name,
      city,
      type,
      deliveryDays,
      pickupAvailable,
      shippingAvailable,
      priority,
    ]);

    return result.rows[0];
  },

  async findAll(
    {
      type = null,
      supplierId = null,
      includeInactive = false,
    } = {},
    db = pool
  ) {
    const sql = `
      SELECT
        w.*,
        s.name AS supplier_name,
        s.type AS supplier_type,
        s.warehouse_priority_enabled,

        COUNT(po.id)::integer AS offers_count

      FROM warehouses w

      LEFT JOIN suppliers s
        ON s.id = w.supplier_id

      LEFT JOIN product_offers po
        ON po.warehouse_id = w.id

      WHERE ($1::varchar IS NULL OR w.type = $1)
        AND ($2::integer IS NULL OR w.supplier_id = $2)
        AND (
          $3::boolean = TRUE
          OR w.is_active = TRUE
        )

      GROUP BY
        w.id,
        s.name,
        s.type,
        s.warehouse_priority_enabled

      ORDER BY
        CASE
          WHEN w.type = 'OWN'
          THEN 0
          ELSE 1
        END,

        s.name NULLS FIRST,
        w.priority ASC NULLS LAST,
        w.name;
    `;

    const result = await db.query(sql, [
      type,
      supplierId,
      includeInactive,
    ]);

    return result.rows;
  },

  async findPickupAvailable(
    db = pool
  ) {
    const sql = `
      SELECT
        id,
        name,
        city,
        type,
        delivery_days
      FROM warehouses
      WHERE is_active = TRUE
        AND (
          pickup_available = TRUE
          OR type = 'OWN'
        )
      ORDER BY
        CASE
          WHEN type = 'OWN' THEN 0
          ELSE 1
        END,
        city NULLS LAST,
        name;
    `;

    const result =
      await db.query(sql);

    return result.rows;
  },

  async findById(
    warehouseId,
    db = pool
  ) {
    const sql = `
      SELECT
        w.*,
        s.name AS supplier_name,
        s.type AS supplier_type,
        s.warehouse_priority_enabled,

        COUNT(po.id)::integer AS offers_count

      FROM warehouses w

      LEFT JOIN suppliers s
        ON s.id = w.supplier_id

      LEFT JOIN product_offers po
        ON po.warehouse_id = w.id

      WHERE w.id = $1

      GROUP BY
        w.id,
        s.name,
        s.type,
        s.warehouse_priority_enabled

      LIMIT 1;
    `;

    const result = await db.query(sql, [
      warehouseId,
    ]);

    return result.rows[0] ?? null;
  },

  async update(
    warehouseId,
    {
      organizationId,
      supplierId,
      name,
      city,
      type,
      deliveryDays,
      pickupAvailable,
      shippingAvailable,
      priority,
    },
    db = pool
  ) {
    const sql = `
      UPDATE warehouses
      SET
        organization_id =
          COALESCE($2, organization_id),

        supplier_id =
          CASE
            WHEN $3::boolean = TRUE THEN $4
            ELSE supplier_id
          END,

        name =
          COALESCE($5, name),

        city =
          CASE
            WHEN $6::boolean = TRUE THEN $7
            ELSE city
          END,

        type =
          COALESCE($8, type),

        delivery_days =
          COALESCE($9, delivery_days),

        pickup_available =
          COALESCE($10, pickup_available),

        shipping_available =
          COALESCE(
            $11,
            shipping_available
          ),

        priority =
          CASE
            WHEN $12::boolean = TRUE
            THEN $13
            ELSE priority
          END,

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = $1

      RETURNING *;
    `;

    const hasSupplierId =
      supplierId !== undefined;

    const hasCity =
      city !== undefined;

    const hasPriority =
      priority !== undefined;

    const result = await db.query(sql, [
      warehouseId,
      organizationId,
      hasSupplierId,
      supplierId ?? null,
      name,
      hasCity,
      city ?? null,
      type,
      deliveryDays,
      pickupAvailable,
      shippingAvailable,
      hasPriority,
      priority ?? null,
    ]);

    return result.rows[0] ?? null;
  },

  async setActive(
    warehouseId,
    isActive,
    db = pool
  ) {
    const sql = `
      UPDATE warehouses
      SET
        is_active = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
    `;

    const result = await db.query(sql, [
      warehouseId,
      isActive,
    ]);

    return result.rows[0] ?? null;
  },

  async deactivateBySupplier(
    supplierId,
    db = pool
  ) {
    const sql = `
      UPDATE warehouses
      SET
        is_active = FALSE,
        updated_at = CURRENT_TIMESTAMP
      WHERE supplier_id = $1
      RETURNING *;
    `;

    const result = await db.query(sql, [
      supplierId,
    ]);

    return result.rows;
  },
};