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

    const sql = `
      INSERT INTO imports
      (
        warehouse_id,
        supplier_id,
        warehouse_supplier_import_id,

        source,
        file_name,
        file_type,
        import_method,

        status
      )

      VALUES
      (
        $1,
        $2,
        $3,

        $4,
        $5,
        $6,
        $7,

        'PROCESSING'
      )

      RETURNING *;
    `;


    const result = await db.query(
      sql,
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
    },
    db = pool
  ) {

    const sql = `
      INSERT INTO import_rows
      (
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
        raw_data
      )

      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      )

      RETURNING *;
    `;


    const result = await db.query(
      sql,
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
      ]
    );


    return result.rows[0];

  },



  async updateImportResult(
    {
      importId,
      totalRows,
      successRows,
      errorRows,
      status = "COMPLETED",
    },
    db = pool
  ) {

    const sql = `
      UPDATE imports

      SET
        total_rows = $2,
        success_rows = $3,
        error_rows = $4,
        status = $5

      WHERE id = $1

      RETURNING *;
    `;


    const result = await db.query(
      sql,
      [
        importId,
        totalRows,
        successRows,
        errorRows,
        status,
      ]
    );


    return result.rows[0];

  },


  async findErrorRows(
    {
      importId,
      warehouseId,
    },
    db = pool
  ) {
    const sql = `
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

      WHERE
        ir.import_id = $1
        AND i.warehouse_id = $2
        AND ir.status = 'ERROR'

      ORDER BY
        ir.source_row_number NULLS LAST,
        ir.id;
    `;

    const result =
      await db.query(
        sql,
        [
          importId,
          warehouseId,
        ]
      );

    return result.rows;
  },



};