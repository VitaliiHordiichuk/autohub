import { pool } from "../config/db.js";

export const ImportNewProductRepository = {
  async upsertPending(
    {
      warehouseId,
      supplierId,
      warehouseSupplierImportId,
      brandId,
      article,
      articleNormalized,
      name,
      price,
      quantity,
      importId,
      importRowId,
    },
    db = pool
  ) {
    const result = await db.query(
      `
        INSERT INTO import_new_products (
          warehouse_id,
          supplier_id,
          warehouse_supplier_import_id,
          brand_id,
          article,
          article_normalized,
          name,
          price,
          quantity,
          status,
          first_import_id,
          latest_import_id,
          latest_import_row_id,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          'PENDING',$10,$10,$11,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (
          warehouse_id,
          brand_id,
          article_normalized
        )
        DO UPDATE SET
          supplier_id = EXCLUDED.supplier_id,
          warehouse_supplier_import_id =
            EXCLUDED.warehouse_supplier_import_id,
          article = EXCLUDED.article,
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          quantity = EXCLUDED.quantity,
          latest_import_id =
            EXCLUDED.latest_import_id,
          latest_import_row_id =
            EXCLUDED.latest_import_row_id,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `,
      [
        warehouseId,
        supplierId,
        warehouseSupplierImportId,
        brandId,
        article,
        articleNormalized,
        name,
        price,
        quantity,
        importId,
        importRowId,
      ]
    );

    return result.rows[0];
  },

  async removeMissingPending(
    {
      warehouseId,
      activeIds = [],
    },
    db = pool
  ) {
    const safeIds = Array.from(
      new Set(
        activeIds
          .map(Number)
          .filter(
            (value) =>
              Number.isInteger(value) &&
              value > 0
          )
      )
    );

    const result = await db.query(
      `
        DELETE FROM import_new_products
        WHERE warehouse_id = $1
          AND status = 'PENDING'
          AND NOT (
            id = ANY($2::integer[])
          )
        RETURNING id;
      `,
      [warehouseId, safeIds]
    );

    return result.rows;
  },

  async findPending(
    {
      warehouseId = null,
      page = 1,
      pageSize = 50,
    },
    db = pool
  ) {
    const offset =
      (page - 1) * pageSize;

    const countResult = await db.query(
      `
        SELECT COUNT(*)::integer AS total
        FROM import_new_products inp
        WHERE inp.status = 'PENDING'
          AND (
            $1::integer IS NULL
            OR inp.warehouse_id = $1
          );
      `,
      [warehouseId]
    );

    const rowsResult = await db.query(
      `
        SELECT
          inp.*,
          b.name AS brand_name,
          w.name AS warehouse_name,
          w.city AS warehouse_city,
          s.name AS supplier_name
        FROM import_new_products inp
        JOIN brands b
          ON b.id = inp.brand_id
        JOIN warehouses w
          ON w.id = inp.warehouse_id
        LEFT JOIN suppliers s
          ON s.id = inp.supplier_id
        WHERE inp.status = 'PENDING'
          AND (
            $1::integer IS NULL
            OR inp.warehouse_id = $1
          )
        ORDER BY
          inp.updated_at DESC,
          inp.id DESC
        LIMIT $2
        OFFSET $3;
      `,
      [warehouseId, pageSize, offset]
    );

    return {
      rows: rowsResult.rows,
      total: Number(
        countResult.rows[0]?.total ?? 0
      ),
    };
  },

  async findByIdForUpdate(
    id,
    db = pool
  ) {
    const result = await db.query(
      `
        SELECT *
        FROM import_new_products
        WHERE id = $1
        FOR UPDATE;
      `,
      [id]
    );

    return result.rows[0] ?? null;
  },

  async findPendingByWarehouseForUpdate(
    warehouseId,
    db = pool
  ) {
    const result = await db.query(
      `
        SELECT *
        FROM import_new_products
        WHERE warehouse_id = $1
          AND status = 'PENDING'
        ORDER BY id
        FOR UPDATE;
      `,
      [warehouseId]
    );

    return result.rows;
  },

  async markResolved(
    {
      id,
      status,
      productId = null,
      productOfferId = null,
    },
    db = pool
  ) {
    const result = await db.query(
      `
        UPDATE import_new_products
        SET
          status = $2,
          product_id = $3,
          product_offer_id = $4,
          resolved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
      `,
      [
        id,
        status,
        productId,
        productOfferId,
      ]
    );

    return result.rows[0] ?? null;
  },

  async updateLatestImportRow(
    {
      importRowId,
      status,
      productOfferId = null,
    },
    db = pool
  ) {
    if (!importRowId) {
      return null;
    }

    const result = await db.query(
      `
        UPDATE import_rows
        SET
          status = $2,
          product_offer_id = $3
        WHERE id = $1
        RETURNING *;
      `,
      [
        importRowId,
        status,
        productOfferId,
      ]
    );

    return result.rows[0] ?? null;
  },

  async decrementPendingImportCount(
    importId,
    db = pool
  ) {
    if (!importId) {
      return null;
    }

    const result = await db.query(
      `
        UPDATE imports
        SET pending_new_products_count =
          GREATEST(
            COALESCE(
              pending_new_products_count,
              0
            ) - 1,
            0
          )
        WHERE id = $1
        RETURNING *;
      `,
      [importId]
    );

    return result.rows[0] ?? null;
  },

  async findReport(
    {
      importId,
      warehouseId,
    },
    db = pool
  ) {
    const importResult = await db.query(
      `
        SELECT
          id,
          warehouse_id,
          supplier_id,
          warehouse_supplier_import_id,
          file_name,
          file_type,
          import_method,
          status,
          total_rows,
          success_rows,
          error_rows,
          new_products_count,
          pending_new_products_count,
          ignored_new_products_count,
          price_changes_count,
          price_drop_count,
          price_rise_count,
          created_at
        FROM imports
        WHERE id = $1
          AND warehouse_id = $2
        LIMIT 1;
      `,
      [importId, warehouseId]
    );

    const importRow =
      importResult.rows[0] ?? null;

    if (!importRow) {
      return null;
    }

    const rowsResult = await db.query(
      `
        SELECT
          id,
          source_row_number,
          article,
          name,
          brand,
          price,
          quantity,
          status,
          error_message,
          product_offer_id,
          old_price,
          new_price,
          change_percent,
          old_quantity,
          new_quantity,
          quantity_change,
          raw_data,
          created_at
        FROM import_rows
        WHERE import_id = $1
          AND status = ANY(
            $2::varchar[]
          )
        ORDER BY
          source_row_number NULLS LAST,
          id;
      `,
      [
        importId,
        [
          "PENDING_REVIEW",
          "NEW_REJECTED",
          "NEW_IGNORED",
          "NEW_AUTO",
          "PRICE_DROP_ALERT",
          "PRICE_RISE_ALERT",
          "ERROR",
          "APPROVED",
          "REJECTED",
        ],
      ]
    );

    return {
      importRow,
      rows: rowsResult.rows,
    };
  },
};
