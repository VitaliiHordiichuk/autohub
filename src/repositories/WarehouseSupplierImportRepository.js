import { pool } from "../config/db.js";


export const WarehouseSupplierImportRepository = {


  async findByWarehouseId(
    warehouseId,
    db = pool
  ) {

    const sql = `
      SELECT
        wsi.*,

        sis.import_method,
        sis.file_type,

        sis.brand_mode,
        sis.fixed_brand_id,

        sis.brand_column,
        sis.article_column,
        sis.name_column,
        sis.price_column,
        sis.retail_price_column,
        sis.quantity_column,

        w.pricing_model,
        w.retail_markup_percent,
        w.minimum_markup_percent,

        sis.start_row,

        sis.email_from,
        sis.email_subject

      FROM warehouse_supplier_imports wsi


      INNER JOIN supplier_import_settings sis

        ON sis.id =
           wsi.supplier_import_settings_id

      INNER JOIN warehouses w ON w.id = wsi.warehouse_id


      WHERE wsi.warehouse_id = $1

      AND wsi.is_active = TRUE

      LIMIT 1;
    `;


    const result =
      await db.query(
        sql,
        [
          warehouseId
        ]
      );


    return result.rows[0] ?? null;

  },



  async findById(
    id,
    db = pool
  ) {

    const sql = `
      SELECT
        wsi.*,

        sis.import_method,
        sis.file_type,

        sis.brand_mode,
        sis.fixed_brand_id,

        sis.brand_column,
        sis.article_column,
        sis.name_column,
        sis.price_column,
        sis.retail_price_column,
        sis.quantity_column,

        w.pricing_model,
        w.retail_markup_percent,
        w.minimum_markup_percent,

        sis.start_row,

        sis.email_from,
        sis.email_subject

      FROM warehouse_supplier_imports wsi


      INNER JOIN supplier_import_settings sis

        ON sis.id =
           wsi.supplier_import_settings_id

      INNER JOIN warehouses w ON w.id = wsi.warehouse_id


      WHERE wsi.id = $1

      LIMIT 1;
    `;


    const result =
      await db.query(
        sql,
        [
          id
        ]
      );


    return result.rows[0] ?? null;

  },


};
