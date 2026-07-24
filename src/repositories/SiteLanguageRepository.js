import { pool } from "../config/db.js";

function mapLanguage(row) {
  return {
    code: row.code,
    nativeName: row.native_name,
    englishName: row.english_name,
    isPublicEnabled:
      row.is_public_enabled,
    isAdminEnabled:
      row.is_admin_enabled,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SiteLanguageRepository {
  static async findAll() {
    const result = await pool.query(`
      SELECT
        code,
        native_name,
        english_name,
        is_public_enabled,
        is_admin_enabled,
        is_default,
        sort_order,
        created_at,
        updated_at
      FROM site_languages
      ORDER BY
        sort_order ASC,
        code ASC
    `);

    return result.rows.map(mapLanguage);
  }

  static async findPublic() {
    const result = await pool.query(`
      SELECT
        code,
        native_name,
        english_name,
        is_public_enabled,
        is_admin_enabled,
        is_default,
        sort_order,
        created_at,
        updated_at
      FROM site_languages
      WHERE is_public_enabled = TRUE
      ORDER BY
        is_default DESC,
        sort_order ASC,
        code ASC
    `);

    return result.rows.map(mapLanguage);
  }

  static async findByCode(code) {
    const result = await pool.query(
      `
        SELECT
          code,
          native_name,
          english_name,
          is_public_enabled,
          is_admin_enabled,
          is_default,
          sort_order,
          created_at,
          updated_at
        FROM site_languages
        WHERE code = $1
        LIMIT 1
      `,
      [code]
    );

    if (!result.rows[0]) {
      return null;
    }

    return mapLanguage(result.rows[0]);
  }

  static async update(
    code,
    changes
  ) {
    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      if (changes.isDefault === true) {
        await client.query(`
          UPDATE site_languages
          SET
            is_default = FALSE,
            updated_at = NOW()
          WHERE is_default = TRUE
        `);
      }

      const setParts = [];
      const values = [];

      function add(column, value) {
        values.push(value);
        setParts.push(
          `${column} = $${values.length}`
        );
      }

      if (
        changes.isPublicEnabled !==
        undefined
      ) {
        add(
          "is_public_enabled",
          changes.isPublicEnabled
        );
      }

      if (
        changes.isAdminEnabled !==
        undefined
      ) {
        add(
          "is_admin_enabled",
          changes.isAdminEnabled
        );
      }

      if (
        changes.sortOrder !== undefined
      ) {
        add(
          "sort_order",
          changes.sortOrder
        );
      }

      if (changes.isDefault === true) {
        add("is_default", true);
        add("is_public_enabled", true);
      }

      setParts.push(
        "updated_at = NOW()"
      );

      values.push(code);

      const result =
        await client.query(
          `
            UPDATE site_languages
            SET ${setParts.join(", ")}
            WHERE code = $${values.length}
            RETURNING
              code,
              native_name,
              english_name,
              is_public_enabled,
              is_admin_enabled,
              is_default,
              sort_order,
              created_at,
              updated_at
          `,
          values
        );

      if (!result.rows[0]) {
        throw new Error(
          "Мову не знайдено"
        );
      }

      await client.query("COMMIT");

      return mapLanguage(
        result.rows[0]
      );

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;

    } finally {
      client.release();
    }
  }
}
