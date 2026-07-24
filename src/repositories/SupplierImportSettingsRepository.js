import { pool } from "../config/db.js";


export const SupplierImportSettingsRepository = {


  async findBySupplierId(
    supplierId,
    db = pool
  ) {

    const sql = `
      SELECT *
      FROM supplier_import_settings
      WHERE supplier_id = $1
      LIMIT 1;
    `;


    const result =
      await db.query(
        sql,
        [
          supplierId
        ]
      );


    return result.rows[0] ?? null;

  },



  async findBySupplierAndMethod(
    supplierId,
    importMethod,
    db = pool
  ) {

    const sql = `
      SELECT *
      FROM supplier_import_settings
      WHERE supplier_id = $1
      AND import_method = $2
      AND is_active = true
      LIMIT 1;
    `;


    const result =
      await db.query(
        sql,
        [
          supplierId,
          importMethod
        ]
      );


    return result.rows[0] ?? null;

  },


};