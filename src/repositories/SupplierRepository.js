import { pool } from "../config/db.js";

export const SupplierRepository = {
  async create(
    {
      name,
      deliveryDays = 0,
      type = "PARTNER",
      warehousePriorityEnabled = false,
      phone = null,
      email = null,
      contactPerson = null,
      edrpou = null,
      bankAccount = null,
      website = null,
      city = null,
      comment = null,
    },
    db = pool
  ) {
    const sql = `
      INSERT INTO suppliers (
        name,
        delivery_days,
        type,
        warehouse_priority_enabled,
        phone,
        email,
        contact_person,
        edrpou,
        bank_account,
        website,
        city,
        comment,
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
        $10,
        $11,
        $12,
        TRUE,
        CURRENT_TIMESTAMP
      )
      RETURNING *;
    `;

    const result = await db.query(
      sql,
      [
        name,
        deliveryDays,
        type,
        warehousePriorityEnabled,
        phone,
        email,
        contactPerson,
        edrpou,
        bankAccount,
        website,
        city,
        comment,
      ]
    );

    return result.rows[0];
  },

  async findAll(
    {
      includeInactive = false,
    } = {},
    db = pool
  ) {
    const sql = `
      SELECT
        s.*,
        COUNT(w.id)::integer AS warehouses_count
      FROM suppliers s
      LEFT JOIN warehouses w
        ON w.supplier_id = s.id
      WHERE ($1::boolean = TRUE OR s.is_active = TRUE)
      GROUP BY s.id
      ORDER BY s.name;
    `;

    const result = await db.query(sql, [
      includeInactive,
    ]);

    return result.rows;
  },


  async findById(
    supplierId,
    db = pool
  ) {
    const sql = `
      SELECT *
      FROM suppliers
      WHERE id = $1
      LIMIT 1;
    `;

    const result = await db.query(sql, [
      supplierId,
    ]);

    return result.rows[0] ?? null;
  },


  async update(
    supplierId,
    {
      name,
      deliveryDays,
      type,
      warehousePriorityEnabled,
      phone,
      email,
      contactPerson,
      edrpou,
      bankAccount,
      website,
      city,
      comment,
    },
    db = pool
  ) {
    const sql = `
      UPDATE suppliers
      SET
        name =
          COALESCE($2, name),

        delivery_days =
          COALESCE(
            $3,
            delivery_days
          ),

        type =
          COALESCE($4, type),

        warehouse_priority_enabled =
          COALESCE(
            $5,
            warehouse_priority_enabled
          ),

        phone =
          COALESCE($6, phone),

        email =
          COALESCE($7, email),

        contact_person =
          COALESCE(
            $8,
            contact_person
          ),

        edrpou =
          COALESCE($9, edrpou),

        bank_account =
          COALESCE(
            $10,
            bank_account
          ),

        website =
          COALESCE($11, website),

        city =
          COALESCE($12, city),

        comment =
          COALESCE($13, comment),

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = $1

      RETURNING *;
    `;

    const result = await db.query(
      sql,
      [
        supplierId,
        name,
        deliveryDays,
        type,
        warehousePriorityEnabled,
        phone,
        email,
        contactPerson,
        edrpou,
        bankAccount,
        website,
        city,
        comment,
      ]
    );

    return result.rows[0] ?? null;
  },

async findWarehouses(
  supplierId,
  db = pool
) {

  const sql = `
    SELECT
      w.*,
      COUNT(po.id)::integer AS offers_count

    FROM warehouses w

    LEFT JOIN product_offers po
      ON po.warehouse_id = w.id

    WHERE w.supplier_id = $1

    GROUP BY w.id

    ORDER BY
      w.priority ASC NULLS LAST,
      w.city NULLS LAST,
      w.name;
  `;


  const result = await db.query(
    sql,
    [
      supplierId,
    ]
  );


  return result.rows;
},

  async syncLinkedWarehouseTypes(
    supplierId,
    supplierType,
    db = pool
  ) {
    const warehouseType =
      supplierType === "OWN"
        ? "OWN"
        : "SUPPLIER";

    const offerSourceType =
      supplierType === "OWN"
        ? "OWN_STOCK"
        : "SUPPLIER";


    await db.query(
      `
        UPDATE warehouses
        SET
          type = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE supplier_id = $1;
      `,
      [
        supplierId,
        warehouseType,
      ]
    );


    await db.query(
      `
        UPDATE product_offers po
        SET
          source_type = $2,
          updated_at = CURRENT_TIMESTAMP
        FROM warehouses w
        WHERE w.id = po.warehouse_id
          AND w.supplier_id = $1;
      `,
      [
        supplierId,
        offerSourceType,
      ]
    );
  },


  async setActive(
    supplierId,
    isActive,
    db = pool
  ) {
    const sql = `
      UPDATE suppliers
      SET
        is_active = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
    `;

    const result = await db.query(sql, [
      supplierId,
      isActive,
    ]);

    return result.rows[0] ?? null;
  },
  async findArticleSearchRules(
    supplierId,
    db = pool
  ) {
    const sql = `
      SELECT
        id,
        supplier_id,
        rule_code,
        is_enabled,
        created_at,
        updated_at
      FROM supplier_article_search_rules
      WHERE supplier_id = $1
      ORDER BY rule_code;
    `;

    const result = await db.query(
      sql,
      [supplierId]
    );

    return result.rows;
  },


  async upsertArticleSearchRule(
    supplierId,
    ruleCode,
    isEnabled,
    db = pool
  ) {
    const sql = `
      INSERT INTO
        supplier_article_search_rules (
          supplier_id,
          rule_code,
          is_enabled,
          updated_at
        )
      VALUES (
        $1,
        $2,
        $3,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (
        supplier_id,
        rule_code
      )
      DO UPDATE SET
        is_enabled =
          EXCLUDED.is_enabled,

        updated_at =
          CURRENT_TIMESTAMP

      RETURNING
        id,
        supplier_id,
        rule_code,
        is_enabled,
        created_at,
        updated_at;
    `;

    const result = await db.query(
      sql,
      [
        supplierId,
        ruleCode,
        isEnabled,
      ]
    );

    return result.rows[0];
  },


  async findEnabledSupplierIdsByArticleSearchRule(
    ruleCode,
    db = pool
  ) {
    const sql = `
      SELECT DISTINCT
        rules.supplier_id

      FROM supplier_article_search_rules
        AS rules

      JOIN suppliers s
        ON s.id = rules.supplier_id

      WHERE rules.rule_code = $1
        AND rules.is_enabled = TRUE
        AND s.is_active = TRUE

      ORDER BY rules.supplier_id;
    `;

    const result = await db.query(
      sql,
      [ruleCode]
    );

    return result.rows.map(
      (row) =>
        Number(row.supplier_id)
    );
  },


};
