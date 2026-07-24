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
        product_offer_id
      )

      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9
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


};