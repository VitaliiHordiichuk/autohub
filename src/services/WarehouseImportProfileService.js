import { pool } from "../config/db.js";

const FILE_TYPES = ["CSV", "XLSX"];
const BRAND_MODES = ["FIXED", "FROM_FILE"];
const EMAIL_MATCH_MODES = [
  "SENDER_ONLY",
  "SUBJECT",
  "FILENAME",
  "SUBJECT_AND_FILENAME",
  "SUBJECT_OR_FILENAME",
];

function positiveInteger(value, fieldName, { nullable = false } = {}) {
  if (
    nullable &&
    (value === null || value === undefined || value === "")
  ) {
    return null;
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(
      `${fieldName}: укажите целое число больше нуля`
    );
  }

  return number;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeEmail(value) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!email) {
    return null;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(
      "Укажите корректный адрес отправителя"
    );
  }

  return email;
}

function validateEmailRule({
  enabled,
  emailFrom,
  matchMode,
  subjectContains,
  filenameContains,
}) {
  if (!enabled) {
    return;
  }

  if (!emailFrom) {
    throw new Error(
      "Для автоматического импорта укажите почту отправителя"
    );
  }

  if (!EMAIL_MATCH_MODES.includes(matchMode)) {
    throw new Error(
      "Выбран неизвестный способ определения письма"
    );
  }

  if (
    (matchMode === "SUBJECT" ||
      matchMode === "SUBJECT_AND_FILENAME") &&
    !subjectContains
  ) {
    throw new Error(
      "Для выбранного правила укажите текст темы письма"
    );
  }

  if (
    (matchMode === "FILENAME" ||
      matchMode === "SUBJECT_AND_FILENAME") &&
    !filenameContains
  ) {
    throw new Error(
      "Для выбранного правила укажите часть названия файла"
    );
  }

  if (
    matchMode === "SUBJECT_OR_FILENAME" &&
    !subjectContains &&
    !filenameContains
  ) {
    throw new Error(
      "Укажите текст темы или часть названия файла"
    );
  }
}

function mapProfile(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    warehouseId: Number(row.warehouse_id),
    supplierId: Number(row.supplier_id),
    supplierImportSettingsId:
      Number(row.supplier_import_settings_id),
    isActive: row.is_active === true,
    fileType: row.file_type,
    brandMode: row.brand_mode,
    fixedBrandId:
      row.fixed_brand_id === null
        ? null
        : Number(row.fixed_brand_id),
    brandColumn:
      row.brand_column === null
        ? null
        : Number(row.brand_column),
    articleColumn: Number(row.article_column),
    nameColumn: Number(row.name_column),
    priceColumn: Number(row.price_column),
    quantityColumn: Number(row.quantity_column),
    startRow: Number(row.start_row),
    emailAutoImportEnabled:
      row.email_auto_import_enabled === true,
    emailFrom: row.email_from,
    emailMatchMode: row.email_match_mode,
    emailSubjectContains:
      row.email_subject_contains,
    emailFilenameContains:
      row.email_filename_contains,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findWarehouse(db, warehouseId) {
  const result = await db.query(
    `
      SELECT
        w.id,
        w.name,
        w.city,
        w.is_active,
        w.supplier_id,
        s.name AS supplier_name,
        s.type AS supplier_type,
        s.is_active AS supplier_is_active
      FROM warehouses AS w
      LEFT JOIN suppliers AS s
        ON s.id = w.supplier_id
      WHERE w.id = $1
      LIMIT 1
    `,
    [warehouseId]
  );

  return result.rows[0] ?? null;
}

async function findProfile(
  db,
  warehouseId,
  supplierId = null
) {
  const result = await db.query(
    `
      SELECT
        wsi.*,
        sis.file_type,
        sis.brand_mode,
        sis.fixed_brand_id,
        sis.brand_column,
        sis.article_column,
        sis.name_column,
        sis.price_column,
        sis.quantity_column,
        sis.start_row,
        COALESCE(
          wsi.updated_at,
          sis.updated_at
        ) AS updated_at
      FROM warehouse_supplier_imports AS wsi
      JOIN supplier_import_settings AS sis
        ON sis.id =
           wsi.supplier_import_settings_id
      WHERE wsi.warehouse_id = $1
        AND (
          $2::integer IS NULL OR
          wsi.supplier_id = $2
        )
      ORDER BY
        wsi.is_active DESC,
        wsi.id DESC
      LIMIT 1
    `,
    [
      warehouseId,
      supplierId,
    ]
  );

  return result.rows[0] ?? null;
}

async function validateNoEmailConflict(
  db,
  {
    warehouseSupplierImportId,
    emailFrom,
    emailMatchMode,
    emailSubjectContains,
    emailFilenameContains,
  }
) {
  const result = await db.query(
    `
      SELECT
        wsi.id,
        w.name AS warehouse_name,
        wsi.email_match_mode,
        wsi.email_subject_contains,
        wsi.email_filename_contains
      FROM warehouse_supplier_imports AS wsi
      JOIN warehouses AS w
        ON w.id = wsi.warehouse_id
      WHERE wsi.is_active = TRUE
        AND wsi.email_auto_import_enabled = TRUE
        AND LOWER(BTRIM(wsi.email_from)) =
            LOWER(BTRIM($1))
        AND (
          $2::integer IS NULL OR
          wsi.id <> $2
        )
    `,
    [
      emailFrom,
      warehouseSupplierImportId,
    ]
  );

  for (const existing of result.rows) {
    const existingMode =
      existing.email_match_mode;

    if (
      emailMatchMode === "SENDER_ONLY" ||
      existingMode === "SENDER_ONLY"
    ) {
      throw new Error(
        `Эта почта уже используется для склада «${existing.warehouse_name}». Для одной почты нельзя совмещать правило «только отправитель» с другими складами`
      );
    }

    const sameSubject =
      String(
        existing.email_subject_contains ?? ""
      )
        .trim()
        .toLowerCase() ===
      String(emailSubjectContains ?? "")
        .trim()
        .toLowerCase();

    const sameFilename =
      String(
        existing.email_filename_contains ?? ""
      )
        .trim()
        .toLowerCase() ===
      String(emailFilenameContains ?? "")
        .trim()
        .toLowerCase();

    if (
      existingMode === emailMatchMode &&
      sameSubject &&
      sameFilename
    ) {
      throw new Error(
        `Такое же почтовое правило уже настроено для склада «${existing.warehouse_name}»`
      );
    }
  }
}

export const WarehouseImportProfileService = {
  async getProfile(warehouseIdValue) {
    const warehouseId = positiveInteger(
      warehouseIdValue,
      "Некорректный номер склада"
    );

    const db = await pool.connect();

    try {
      const warehouse = await findWarehouse(
        db,
        warehouseId
      );

      if (!warehouse) {
        throw new Error("Склад не найден");
      }

      const profile = await findProfile(
        db,
        warehouseId,
        warehouse.supplier_id
      );

      return {
        warehouse: {
          id: Number(warehouse.id),
          name: warehouse.name,
          city: warehouse.city,
          isActive:
            warehouse.is_active === true,
          supplierId:
            warehouse.supplier_id === null
              ? null
              : Number(warehouse.supplier_id),
          supplierName:
            warehouse.supplier_name,
          supplierType:
            warehouse.supplier_type,
          supplierIsActive:
            warehouse.supplier_is_active === true,
        },
        profile: mapProfile(profile),
      };
    } finally {
      db.release();
    }
  },

  async saveProfile(
    warehouseIdValue,
    data = {}
  ) {
    const warehouseId = positiveInteger(
      warehouseIdValue,
      "Некорректный номер склада"
    );

    const fileType = String(
      data.fileType ?? "CSV"
    )
      .trim()
      .toUpperCase();

    const brandMode = String(
      data.brandMode ?? "FROM_FILE"
    )
      .trim()
      .toUpperCase();

    if (!FILE_TYPES.includes(fileType)) {
      throw new Error(
        "Поддерживаются только CSV и XLSX"
      );
    }

    if (!BRAND_MODES.includes(brandMode)) {
      throw new Error(
        "Выбран неизвестный режим бренда"
      );
    }

    const fixedBrandId = positiveInteger(
      data.fixedBrandId,
      "Некорректный бренд",
      { nullable: true }
    );

    const brandColumn = positiveInteger(
      data.brandColumn,
      "Некорректная колонка бренда",
      { nullable: true }
    );

    const articleColumn = positiveInteger(
      data.articleColumn ?? 1,
      "Некорректная колонка артикула"
    );

    const nameColumn = positiveInteger(
      data.nameColumn ?? 2,
      "Некорректная колонка названия"
    );

    const priceColumn = positiveInteger(
      data.priceColumn ?? 3,
      "Некорректная колонка цены"
    );

    const quantityColumn = positiveInteger(
      data.quantityColumn ?? 4,
      "Некорректная колонка количества"
    );

    const startRow = positiveInteger(
      data.startRow ?? 2,
      "Некорректная первая строка данных"
    );

    if (
      brandMode === "FIXED" &&
      fixedBrandId === null
    ) {
      throw new Error(
        "Для фиксированного бренда выберите бренд"
      );
    }

    if (
      brandMode === "FROM_FILE" &&
      brandColumn === null
    ) {
      throw new Error(
        "Укажите колонку бренда"
      );
    }

    const isActive =
      data.isActive !== false;

    const emailAutoImportEnabled =
      data.emailAutoImportEnabled === true;

    const emailFrom = normalizeEmail(
      data.emailFrom
    );

    const emailMatchMode = String(
      data.emailMatchMode ??
        "SENDER_ONLY"
    )
      .trim()
      .toUpperCase();

    const emailSubjectContains =
      normalizeText(
        data.emailSubjectContains
      );

    const emailFilenameContains =
      normalizeText(
        data.emailFilenameContains
      );

    validateEmailRule({
      enabled:
        emailAutoImportEnabled,
      emailFrom,
      matchMode:
        emailMatchMode,
      subjectContains:
        emailSubjectContains,
      filenameContains:
        emailFilenameContains,
    });

    const db = await pool.connect();

    try {
      await db.query("BEGIN");

      const warehouse = await findWarehouse(
        db,
        warehouseId
      );

      if (!warehouse) {
        throw new Error("Склад не найден");
      }

      if (
        warehouse.supplier_id === null
      ) {
        throw new Error(
          "Сначала привяжите склад к источнику"
        );
      }

      if (
        warehouse.supplier_is_active !== true
      ) {
        throw new Error(
          "Источник отключён"
        );
      }

      const current = await findProfile(
        db,
        warehouseId,
        warehouse.supplier_id
      );

      if (emailAutoImportEnabled) {
        await validateNoEmailConflict(
          db,
          {
            warehouseSupplierImportId:
              current?.id
                ? Number(current.id)
                : null,
            emailFrom,
            emailMatchMode,
            emailSubjectContains,
            emailFilenameContains,
          }
        );
      }

      let settingsId;

      if (current) {
        settingsId = Number(
          current.supplier_import_settings_id
        );

        await db.query(
          `
            UPDATE supplier_import_settings
            SET
              supplier_id = $2,
              import_method = $3,
              file_type = $4,
              brand_mode = $5,
              fixed_brand_id = $6,
              brand_column = $7,
              article_column = $8,
              name_column = $9,
              price_column = $10,
              quantity_column = $11,
              start_row = $12,
              is_active = $13,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [
            settingsId,
            Number(warehouse.supplier_id),
            emailAutoImportEnabled
              ? "EMAIL"
              : "MANUAL",
            fileType,
            brandMode,
            fixedBrandId,
            brandColumn,
            articleColumn,
            nameColumn,
            priceColumn,
            quantityColumn,
            startRow,
            isActive,
          ]
        );

        await db.query(
          `
            UPDATE warehouse_supplier_imports
            SET
              supplier_id = $2,
              is_active = $3,
              email_auto_import_enabled = $4,
              email_from = $5,
              email_match_mode = $6,
              email_subject_contains = $7,
              email_filename_contains = $8,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [
            Number(current.id),
            Number(warehouse.supplier_id),
            isActive,
            emailAutoImportEnabled,
            emailFrom,
            emailMatchMode,
            emailSubjectContains,
            emailFilenameContains,
          ]
        );
      } else {
        const settingsResult =
          await db.query(
            `
              INSERT INTO
                supplier_import_settings
              (
                supplier_id,
                import_method,
                file_type,
                brand_mode,
                fixed_brand_id,
                brand_column,
                article_column,
                name_column,
                price_column,
                quantity_column,
                start_row,
                is_active
              )
              VALUES
              (
                $1,$2,$3,$4,$5,$6,
                $7,$8,$9,$10,$11,$12
              )
              RETURNING id
            `,
            [
              Number(warehouse.supplier_id),
              emailAutoImportEnabled
                ? "EMAIL"
                : "MANUAL",
              fileType,
              brandMode,
              fixedBrandId,
              brandColumn,
              articleColumn,
              nameColumn,
              priceColumn,
              quantityColumn,
              startRow,
              isActive,
            ]
          );

        settingsId = Number(
          settingsResult.rows[0].id
        );

        await db.query(
          `
            UPDATE warehouse_supplier_imports
            SET
              is_active = FALSE,
              email_auto_import_enabled = FALSE,
              updated_at = CURRENT_TIMESTAMP
            WHERE warehouse_id = $1
          `,
          [warehouseId]
        );

        await db.query(
          `
            INSERT INTO
              warehouse_supplier_imports
            (
              warehouse_id,
              supplier_id,
              supplier_import_settings_id,
              is_active,
              email_auto_import_enabled,
              email_from,
              email_match_mode,
              email_subject_contains,
              email_filename_contains
            )
            VALUES
            (
              $1,$2,$3,$4,$5,
              $6,$7,$8,$9
            )
          `,
          [
            warehouseId,
            Number(warehouse.supplier_id),
            settingsId,
            isActive,
            emailAutoImportEnabled,
            emailFrom,
            emailMatchMode,
            emailSubjectContains,
            emailFilenameContains,
          ]
        );
      }

      await db.query("COMMIT");

      return await this.getProfile(
        warehouseId
      );
    } catch(error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  },
};
