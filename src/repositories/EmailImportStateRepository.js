import { pool } from "../config/db.js";


function getDb(db) {
  return db || pool;
}


export const EmailImportStateRepository = {

  async getOrCreate(
    {
      accountKey,
      mailbox = "INBOX",
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        INSERT INTO email_import_state (
          account_key,
          mailbox
        )
        VALUES ($1, $2)
        ON CONFLICT (
          account_key,
          mailbox
        )
        DO UPDATE SET
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [accountKey, mailbox]
    );

    return result.rows[0] || null;
  },


  async setUidValidity(
    {
      id,
      uidValidity,
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        UPDATE email_import_state
        SET
          uid_validity = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [id, uidValidity]
    );

    return result.rows[0] || null;
  },


  async markStarted(
    {
      id,
      source,
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        UPDATE email_import_state
        SET
          last_run_source = $2,
          last_started_at = CURRENT_TIMESTAMP,
          last_finished_at = NULL,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [id, source]
    );

    return result.rows[0] || null;
  },


  async markProgress(
    {
      id,
      lastUid,
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        UPDATE email_import_state
        SET
          last_uid = GREATEST(last_uid, $2),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [id, lastUid]
    );

    return result.rows[0] || null;
  },


  async markSucceeded(
    {
      id,
      lastUid,
      result,
    },
    db = null
  ) {
    const queryResult = await getDb(db).query(
      `
        UPDATE email_import_state
        SET
          last_uid = GREATEST(last_uid, $2),
          last_finished_at = CURRENT_TIMESTAMP,
          last_success_at = CURRENT_TIMESTAMP,
          last_error = NULL,
          last_result = $3::jsonb,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [id, lastUid, JSON.stringify(result || {})]
    );

    return queryResult.rows[0] || null;
  },


  async markFailed(
    {
      id,
      errorMessage,
      result = null,
    },
    db = null
  ) {
    const queryResult = await getDb(db).query(
      `
        UPDATE email_import_state
        SET
          last_finished_at = CURRENT_TIMESTAMP,
          last_error = $2,
          last_result = $3::jsonb,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        String(errorMessage || "Неизвестная ошибка EMAIL-импорта"),
        JSON.stringify(result || {}),
      ]
    );

    return queryResult.rows[0] || null;
  },


  async findByAccount(
    {
      accountKey,
      mailbox = "INBOX",
    },
    db = null
  ) {
    const result = await getDb(db).query(
      `
        SELECT *
        FROM email_import_state
        WHERE account_key = $1
          AND mailbox = $2
        LIMIT 1
      `,
      [accountKey, mailbox]
    );

    return result.rows[0] || null;
  },

};
