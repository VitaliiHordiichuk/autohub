import { pool } from "../config/db.js";


function getDb(db) {
  return db || pool;
}


export const EmailImportFileRepository = {

  async findExact(
    {
      warehouseSupplierImportId,
      emailMessageId,
      attachmentSha256,
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        SELECT
          eif.*,
          i.status AS import_status,
          i.success_rows AS import_success_rows,
          i.error_rows AS import_error_rows
        FROM email_import_files eif
        LEFT JOIN imports i ON i.id = eif.import_id
        WHERE eif.warehouse_supplier_import_id = $1
          AND eif.email_message_id = $2
          AND eif.attachment_sha256 = $3
        LIMIT 1
      `,
      [
        warehouseSupplierImportId,
        emailMessageId,
        attachmentSha256,
      ]
    );

    return result.rows[0] || null;
  },


  async findCompletedByHash(
    {
      warehouseSupplierImportId,
      attachmentSha256,
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        SELECT eif.*
        FROM email_import_files eif
        LEFT JOIN imports i ON i.id = eif.import_id
        WHERE eif.warehouse_supplier_import_id = $1
          AND eif.attachment_sha256 = $2
          AND eif.status = 'COMPLETED'
          AND ((i.status IN ('COMPLETED', 'COMPLETED_WITH_ERRORS') AND i.success_rows > 0)
            OR (eif.import_id IS NULL AND eif.has_successful_import = TRUE))
        ORDER BY eif.id DESC
        LIMIT 1
      `,
      [
        warehouseSupplierImportId,
        attachmentSha256,
      ]
    );

    return result.rows[0] || null;
  },


  async findRecentUntrackedImport(
    {
      warehouseSupplierImportId,
      fileName,
      receivedAt,
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        SELECT i.*
        FROM imports i
        LEFT JOIN email_import_files eif
          ON eif.import_id = i.id
        WHERE i.warehouse_supplier_import_id = $1
          AND i.import_method = 'EMAIL'
          AND i.file_name = $2
          AND i.status = 'COMPLETED'
          AND eif.id IS NULL
          AND i.created_at >= COALESCE(
            $3::timestamptz - INTERVAL '24 hours',
            CURRENT_TIMESTAMP - INTERVAL '24 hours'
          )
        ORDER BY i.id DESC
        LIMIT 1
      `,
      [
        warehouseSupplierImportId,
        fileName,
        receivedAt || null,
      ]
    );

    return result.rows[0] || null;
  },


  async createProcessing(
    {
      warehouseSupplierImportId,
      supplierImportSettingsId,
      emailMessageId,
      emailUid,
      emailFrom,
      emailSubject,
      attachmentName,
      attachmentSha256,
      receivedAt,
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        INSERT INTO email_import_files (
          warehouse_supplier_import_id,
          supplier_import_settings_id,
          email_message_id,
          email_uid,
          email_from,
          email_subject,
          attachment_name,
          attachment_sha256,
          status,
          received_at,
          processed_at,
          error_message
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
          'PROCESSING',
          $9,
          NULL,
          NULL
        )
        ON CONFLICT (
          warehouse_supplier_import_id,
          email_message_id,
          attachment_sha256
        )
        DO NOTHING
        RETURNING *
      `,
      [
        warehouseSupplierImportId,
        supplierImportSettingsId,
        emailMessageId,
        emailUid,
        emailFrom,
        emailSubject,
        attachmentName,
        attachmentSha256,
        receivedAt || null,
      ]
    );

    return result.rows[0] || null;
  },


  async createCompletedReference(
    {
      warehouseSupplierImportId,
      supplierImportSettingsId,
      emailMessageId,
      emailUid,
      emailFrom,
      emailSubject,
      attachmentName,
      attachmentSha256,
      importId,
      receivedAt,
      hasSuccessfulImport = false,
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        WITH report AS (
          SELECT id,status,success_rows FROM imports WHERE id=$9 FOR KEY SHARE
        )
        INSERT INTO email_import_files (
          warehouse_supplier_import_id,
          supplier_import_settings_id,
          email_message_id,
          email_uid,
          email_from,
          email_subject,
          attachment_name,
          attachment_sha256,
          status,
          import_id,
          received_at,
          processed_at,
          error_message,
          has_successful_import
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
          'COMPLETED',
          (SELECT id FROM report),
          $10,
          CURRENT_TIMESTAMP,
          NULL,
          CASE WHEN NOT EXISTS (SELECT 1 FROM report) THEN $11::boolean ELSE EXISTS (
            SELECT 1 FROM report
              WHERE status IN ('COMPLETED','COMPLETED_WITH_ERRORS') AND success_rows>0
          ) END
        )
        ON CONFLICT (
          warehouse_supplier_import_id,
          email_message_id,
          attachment_sha256
        )
        DO UPDATE SET
          status = 'COMPLETED',
          import_id = EXCLUDED.import_id,
          processed_at = CURRENT_TIMESTAMP,
          error_message = NULL,
          has_successful_import = EXCLUDED.has_successful_import,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [
        warehouseSupplierImportId,
        supplierImportSettingsId,
        emailMessageId,
        emailUid,
        emailFrom,
        emailSubject,
        attachmentName,
        attachmentSha256,
        importId || null,
        receivedAt || null,
        hasSuccessfulImport,
      ]
    );

    return result.rows[0] || null;
  },


  async retryFailed(id, db = null) {
    const result = await getDb(db).query(
      `
        UPDATE email_import_files
        SET
          status = 'PROCESSING',
          has_successful_import = FALSE,
          error_message = NULL,
          processed_at = NULL,
          attempt_count = attempt_count + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status = 'FAILED'
        RETURNING *
      `,
      [id]
    );

    return result.rows[0] || null;
  },


  async markCompleted(
    {
      id,
      importId,
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        UPDATE email_import_files
        SET
          status = 'COMPLETED',
          import_id = $2,
          has_successful_import = EXISTS (SELECT 1 FROM imports WHERE id=$2
            AND status IN ('COMPLETED','COMPLETED_WITH_ERRORS') AND success_rows>0),
          error_message = NULL,
          processed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [id, importId]
    );

    return result.rows[0] || null;
  },


  async markFailed(
    {
      id,
      errorMessage,
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        UPDATE email_import_files
        SET
          status = 'FAILED',
          has_successful_import = FALSE,
          error_message = $2,
          processed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [id, String(errorMessage || "Неизвестная ошибка")]
    );

    return result.rows[0] || null;
  },

  async findRetryableFailed(
    {
      limit = 20,
      maxAttempts = 5,
    } = {},
    db = null
  ) {
    const result = await getDb(db).query(
      `
        SELECT
          eif.*,

          wsi.warehouse_id,
          wsi.supplier_id,
          wsi.email_from AS rule_email_from,
          wsi.email_match_mode,
          wsi.email_subject_contains,
          wsi.email_filename_contains,

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

        FROM email_import_files AS eif

        JOIN warehouse_supplier_imports AS wsi
          ON wsi.id = eif.warehouse_supplier_import_id

        JOIN supplier_import_settings AS sis
          ON sis.id = eif.supplier_import_settings_id

        JOIN suppliers AS s
          ON s.id = wsi.supplier_id

        JOIN warehouses AS w
          ON w.id = wsi.warehouse_id


        WHERE eif.status = 'FAILED'
          AND eif.attempt_count < $1
          AND eif.email_uid IS NOT NULL
          AND wsi.is_active = TRUE
          AND sis.is_active = TRUE
          AND wsi.email_auto_import_enabled = TRUE

        ORDER BY
          eif.processed_at NULLS FIRST,
          eif.id

        LIMIT $2
      `,
      [maxAttempts, limit]
    );

    return result.rows;
  },


};
