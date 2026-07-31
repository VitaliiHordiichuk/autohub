import { pool } from "../config/db.js";
import { transaction } from "../db/transaction.js";

export const CUSTOMER_PRICING_PERMISSION = "MANAGE_CUSTOMER_PRICING";

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Некорректный ${label}`);
  return id;
}

export const CustomerManagementService = {
  async hasPricingAccess(userId, role, db = pool) {
    if (role === "ADMIN") return true;
    if (role !== "MANAGER") return false;
    const result = await db.query(`
      SELECT 1 FROM manager_permissions
      WHERE user_id = $1 AND permission_code = $2 LIMIT 1`,
    [userId, CUSTOMER_PRICING_PERMISSION]);
    return result.rowCount > 0;
  },

  async getPriceGroups(db = pool) {
    const result = await db.query(`
      SELECT id, name, discount_percent, pricing_mode
      FROM price_groups ORDER BY discount_percent, id`);
    return result.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      discountPercent: Number(row.discount_percent),
      pricingMode: row.pricing_mode,
    }));
  },

  async getCustomers(search = "", db = pool) {
    const query = String(search).trim();
    const result = await db.query(`
      SELECT c.id, c.company_name, c.customer_type, c.is_active, c.manager_note,
             u.id AS user_id, u.first_name, u.last_name, u.phone, u.email,
             pg.id AS price_group_id, pg.name AS price_group_name,
             pg.discount_percent, pg.pricing_mode
      FROM customers c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN price_groups pg ON pg.id = c.price_group_id
      WHERE ($1 = '' OR CONCAT_WS(' ', u.first_name, u.last_name, u.email, u.phone,
             c.company_name) ILIKE '%' || $1 || '%')
      ORDER BY u.created_at DESC, c.id DESC
      LIMIT 500`, [query]);
    return result.rows;
  },

  async setPriceGroup({ customerId, priceGroupId, changedBy }) {
    return transaction(async (db) => {
      const id = positiveId(customerId, "customerId");
      const groupId = positiveId(priceGroupId, "priceGroupId");
      const group = await db.query(
        "SELECT id, name FROM price_groups WHERE id = $1 LIMIT 1", [groupId]);
      if (!group.rows[0]) throw new Error("Ценовая группа не найдена");
      const result = await db.query(`
        UPDATE customers SET price_group_id = $2
        WHERE id = $1 AND is_active = TRUE RETURNING *`, [id, groupId]);
      if (!result.rows[0]) throw new Error("Активный клиент не найден");
      await db.query(`
        INSERT INTO customer_history(customer_id, type, description)
        VALUES ($1, 'PRICE_GROUP_CHANGED', $2)`,
      [id, `Ценовая группа изменена на ${group.rows[0].name}; пользователь ${changedBy}`]);
      return result.rows[0];
    });
  },

  async getManagers(db = pool) {
    const result = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.is_active,
             EXISTS(SELECT 1 FROM manager_permissions mp
               WHERE mp.user_id = u.id AND mp.permission_code = $1) AS can_manage_customer_pricing
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'MANAGER' ORDER BY u.first_name, u.last_name, u.email`,
    [CUSTOMER_PRICING_PERMISSION]);
    return result.rows;
  },

  async setManagerPermission({ managerUserId, enabled, grantedBy }, db = pool) {
    const id = positiveId(managerUserId, "managerUserId");
    const manager = await db.query(`
      SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1 AND r.name = 'MANAGER' LIMIT 1`, [id]);
    if (!manager.rows[0]) throw new Error("Менеджер не найден");
    if (enabled) {
      await db.query(`
        INSERT INTO manager_permissions(user_id, permission_code, granted_by)
        VALUES ($1, $2, $3)
        ON CONFLICT(user_id, permission_code)
        DO UPDATE SET granted_by = EXCLUDED.granted_by, created_at = CURRENT_TIMESTAMP`,
      [id, CUSTOMER_PRICING_PERMISSION, grantedBy]);
    } else {
      await db.query(`DELETE FROM manager_permissions
        WHERE user_id = $1 AND permission_code = $2`,
      [id, CUSTOMER_PRICING_PERMISSION]);
    }
    return { managerUserId: id, enabled: Boolean(enabled) };
  },
};
