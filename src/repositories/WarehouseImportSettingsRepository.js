import { pool } from "../config/db.js";


export const WarehouseImportSettingsRepository = {


  async findByWarehouseId(
    warehouseId,
    db = pool
  ) {

    const sql = `
      SELECT *
      FROM warehouse_import_settings
      WHERE warehouse_id = $1
      LIMIT 1;
    `;


    const result = await db.query(
      sql,
      [
        warehouseId
      ]
    );


    return result.rows[0] ?? null;
  },


  async create(
    {
      warehouseId,
      brandMode = "FROM_FILE",
      fixedBrandId = null,
      brandColumn = null,
      articleColumn = 1,
      nameColumn = 2,
      priceColumn = 3,
      quantityColumn = 4,
      startRow = 2,
    },
    db = pool
  ) {

    const sql = `
      INSERT INTO warehouse_import_settings
      (
        warehouse_id,
        brand_mode,
        fixed_brand_id,
        brand_column,
        article_column,
        name_column,
        price_column,
        quantity_column,
        start_row
      )

      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8
      )

      RETURNING *;
    `;


    const result = await db.query(
      sql,
      [
        warehouseId,
        brandMode,
        fixedBrandId,
        brandColumn,
        articleColumn,
        nameColumn,
        priceColumn,
        quantityColumn,
        startRow,
      ]
    );


    return result.rows[0];
  },


  async update(
    warehouseId,
    data,
    db = pool
  ) {

    const sql = `
      UPDATE warehouse_import_settings
      SET

        brand_mode =
          COALESCE($2, brand_mode),

        fixed_brand_id =
          COALESCE($3, fixed_brand_id),

        brand_column =
          COALESCE($4, brand_column),

        article_column =
          COALESCE($5, article_column),

        name_column =
          COALESCE($6, name_column),

        price_column =
          COALESCE($7, price_column),

        quantity_column =
          COALESCE($8, quantity_column),

          start_row =
  COALESCE($9, start_row),

        updated_at =
          CURRENT_TIMESTAMP

      WHERE warehouse_id = $1

      RETURNING *;
    `;


    const result = await db.query(
      sql,
      [
        warehouseId,
        data.brandMode,
        data.fixedBrandId,
        data.brandColumn,
        data.articleColumn,
        data.nameColumn,
        data.priceColumn,
        data.quantityColumn,
          data.startRow,

      ]
    );


    return result.rows[0] ?? null;
  },


};