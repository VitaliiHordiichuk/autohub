import { pool } from "../config/db.js";

const selectSettings = `
  SELECT phone_e164, updated_by, updated_at
  FROM site_contact_settings
  WHERE id = 1
`;

export const SiteContactRepository = {
  async get(db = pool) {
    const result = await db.query(selectSettings);
    return result.rows[0] ?? {
      phone_e164: null,
      updated_by: null,
      updated_at: null,
    };
  },

  async update({ phone, updatedBy }, db = pool) {
    const result = await db.query(
      `INSERT INTO site_contact_settings(id, phone_e164, updated_by, updated_at)
       VALUES (1, $1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         phone_e164 = EXCLUDED.phone_e164,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING phone_e164, updated_by, updated_at`,
      [phone, updatedBy],
    );

    return result.rows[0];
  },
};
