import { pool } from "../config/db.js";

export const ImportRepository = {
  async createImport(
    {
      warehouseId,
      source,
      supplierId = null,
      warehouseSupplierImportId = null,
      fileName = null,
      fileType = null,
      importMethod = null,
    },
    db = pool
  ) {
    const result = await db.query(
      `
        INSERT INTO imports (
          warehouse_id,
          supplier_id,
          warehouse_supplier_import_id,
          source,
          file_name,
          file_type,
          import_method,
          status
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          'PROCESSING'
        )
        RETURNING *;
      `,
      [
        warehouseId,
        supplierId,
        warehouseSupplierImportId,
        source,
        fileName,
        fileType,
        importMethod,
      ]
    );

    return result.rows[0];
  },

  async createImportRow(
    {
      importId,
      article,
      name,
      price,
      quantity,
      brand,
      status = "NEW",
      errorMessage = null,
      productOfferId = null,
      sourceRowNumber = null,
      rawData = null,
      oldPrice = null,
      newPrice = null,
      changePercent = null,
      oldQuantity = null,
      newQuantity = null,
      quantityChange = null,
    },
    db = pool
  ) {
    const result = await db.query(
      `
        INSERT INTO import_rows (
          import_id,
          article,
          name,
          price,
          quantity,
          brand,
          status,
          error_message,
          product_offer_id,
          source_row_number,
          raw_data,
          old_price,
          new_price,
          change_percent,
          old_quantity,
          new_quantity,
          quantity_change
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          $10,$11,$12,$13,$14,$15,$16,$17
        )
        RETURNING *;
      `,
      [
        importId,
        article,
        name,
        price,
        quantity,
        brand,
        status,
        errorMessage,
        productOfferId,
        sourceRowNumber,
        rawData === null
          ? null
          : JSON.stringify(rawData),
        oldPrice,
        newPrice,
        changePercent,
        oldQuantity,
        newQuantity,
        quantityChange,
      ]
    );

    return result.rows[0];
  },

  async updateImportRowStatus(
    {
      importRowId,
      status,
      productOfferId = undefined,
    },
    db = pool
  ) {
    const result = await db.query(
      `
        UPDATE import_rows
        SET
          status = $2,
          product_offer_id =
            CASE
              WHEN $3::boolean = TRUE
              THEN $4
              ELSE product_offer_id
            END
        WHERE id = $1
        RETURNING *;
      `,
      [
        importRowId,
        status,
        productOfferId !== undefined,
        productOfferId ?? null,
      ]
    );

    return result.rows[0] ?? null;
  },

  async updateImportResult(
    {
      importId,
      totalRows,
      successRows,
      errorRows,
      status = "COMPLETED",
      newProductsCount = 0,
      pendingNewProductsCount = 0,
      ignoredNewProductsCount = 0,
      priceChangesCount = 0,
      priceDropCount = 0,
      priceRiseCount = 0,
    },
    db = pool
  ) {
    const result = await db.query(
      `
        UPDATE imports
        SET
          total_rows = $2,
          success_rows = $3,
          error_rows = $4,
          status = $5,
          new_products_count = $6,
          pending_new_products_count = $7,
          ignored_new_products_count = $8,
          price_changes_count = $9,
          price_drop_count = $10,
          price_rise_count = $11
        WHERE id = $1
        RETURNING *;
      `,
      [
        importId,
        totalRows,
        successRows,
        errorRows,
        status,
        newProductsCount,
        pendingNewProductsCount,
        ignoredNewProductsCount,
        priceChangesCount,
        priceDropCount,
        priceRiseCount,
      ]
    );

    return result.rows[0];
  },

  async findHistoryByWarehouse(
    {
      warehouseId,
      page = 1,
      pageSize = 20,
      dateFrom = null,
      dateTo = null,
      importMethod = null,
      status = null,
    },
    db = pool
  ) {
    const offset =
      (page - 1) * pageSize;

    const filterSql = `
      warehouse_id = $1
      AND (
        $2::date IS NULL
        OR created_at >= $2::date
      )
      AND (
        $3::date IS NULL
        OR created_at <
          ($3::date + INTERVAL '1 day')
      )
      AND (
        $4::text IS NULL
        OR import_method = $4
      )
      AND (
        $5::text IS NULL
        OR (
          $5 = 'WITH_ERRORS'
          AND COALESCE(error_rows, 0) > 0
        )
        OR (
          $5 = 'COMPLETED'
          AND COALESCE(error_rows, 0) = 0
          AND status = 'COMPLETED'
        )
        OR (
          $5 = 'FAILED'
          AND status = 'FAILED'
        )
        OR (
          $5 = 'PROCESSING'
          AND status = 'PROCESSING'
        )
      )
    `;

    const filterValues = [
      warehouseId,
      dateFrom,
      dateTo,
      importMethod,
      status,
    ];

    const countResult = await db.query(
      `
        SELECT COUNT(*)::integer AS total
        FROM imports
        WHERE ${filterSql};
      `,
      filterValues
    );

    const rowsResult = await db.query(
      `
        SELECT
          id,
          warehouse_id,
          supplier_id,
          warehouse_supplier_import_id,
          source,
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
        WHERE ${filterSql}
        ORDER BY
          created_at DESC,
          id DESC
        LIMIT $6
        OFFSET $7;
      `,
      [
        ...filterValues,
        pageSize,
        offset,
      ]
    );

    return {
      rows: rowsResult.rows,
      total: Number(
        countResult.rows[0]?.total ?? 0
      ),
    };
  },

  async findErrorRows(
    {
      importId,
      warehouseId,
    },
    db = pool
  ) {
    const result = await db.query(
      `
        SELECT
          ir.id,
          ir.import_id,
          ir.source_row_number,
          ir.article,
          ir.name,
          ir.price,
          ir.quantity,
          ir.brand,
          ir.error_message,
          ir.raw_data,
          ir.created_at
        FROM import_rows ir
        INNER JOIN imports i
          ON i.id = ir.import_id
        WHERE ir.import_id = $1
          AND i.warehouse_id = $2
          AND ir.status = 'ERROR'
        ORDER BY
          ir.source_row_number NULLS LAST,
          ir.id;
      `,
      [importId, warehouseId]
    );

    return result.rows;
  },
};
