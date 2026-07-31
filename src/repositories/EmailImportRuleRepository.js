import { pool } from "../config/db.js";


function getDb(db) {
  return db || pool;
}


export const EmailImportRuleRepository = {

  async findActive(db = null) {
    const result = await getDb(db).query(
      `
        SELECT
          wsi.id AS warehouse_supplier_import_id,
          wsi.warehouse_id,
          wsi.supplier_id,
          wsi.email_auto_import_enabled,
          wsi.email_from,
          wsi.email_match_mode,
          wsi.email_subject_contains,
          wsi.email_filename_contains,

          sis.id AS supplier_import_settings_id,
          sis.brand_mode,
          sis.fixed_brand_id,
          sis.brand_column,
          sis.article_column,
          sis.name_column,
          sis.price_column,
          sis.retail_price_column,
          sis.quantity_column,
          sis.start_row,

          w.pricing_model,

          s.name AS supplier_name

        FROM warehouse_supplier_imports AS wsi

        JOIN supplier_import_settings AS sis
          ON sis.id = wsi.supplier_import_settings_id

        JOIN suppliers AS s
          ON s.id = wsi.supplier_id

        JOIN warehouses AS w
          ON w.id = wsi.warehouse_id


        WHERE wsi.is_active = TRUE
          AND sis.is_active = TRUE
          AND wsi.email_auto_import_enabled = TRUE
          AND NULLIF(BTRIM(wsi.email_from), '') IS NOT NULL

        ORDER BY
          LOWER(wsi.email_from),
          wsi.id
      `
    );

    return result.rows;
  },

};
