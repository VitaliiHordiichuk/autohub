import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";
import { transaction } from "../db/transaction.js";
import {
  CUSTOMER_PRICING_PERMISSION,
  CustomerManagementService,
} from "./CustomerManagementService.js";

const PASSWORD_SALT_ROUNDS = 12;

function text(value) {
  return String(value ?? "").trim();
}

function id(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error("Некорректный employeeId");
  return result;
}

function validatePassword(value) {
  const password = String(value ?? "");
  if (password.length < 8) throw new Error("Пароль должен содержать минимум 8 символов");
  if (password.length > 200) throw new Error("Пароль слишком длинный");
  return password;
}

async function assertManager(employeeId, db) {
  const result = await db.query(`
    SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = $1 AND r.name = 'MANAGER' LIMIT 1`, [employeeId]);
  if (!result.rows[0]) throw new Error("Менеджер не найден");
}

export const EmployeeAdminService = {
  async list(db = pool) {
    const result = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.phone, u.email, u.is_active,
             u.created_at,
             EXISTS(SELECT 1 FROM manager_permissions mp
               WHERE mp.user_id = u.id AND mp.permission_code = $1)
               AS can_manage_customer_pricing
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'MANAGER'
      ORDER BY u.is_active DESC, u.created_at DESC`, [CUSTOMER_PRICING_PERMISSION]);
    return result.rows;
  },

  async create(input, createdBy) {
    const firstName = text(input.firstName);
    const lastName = text(input.lastName);
    const phone = text(input.phone).replace(/[^\d+]/g, "");
    const email = text(input.email).toLowerCase();
    const password = validatePassword(input.password);
    if (!firstName) throw new Error("Имя обязательно");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Некорректный email");

    return transaction(async (db) => {
      const role = await db.query("SELECT id FROM roles WHERE name = 'MANAGER' LIMIT 1");
      if (!role.rows[0]) throw new Error("Роль MANAGER не найдена");
      const existing = await db.query("SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1", [email]);
      if (existing.rows[0]) throw new Error("Пользователь с таким email уже существует");
      const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
      const result = await db.query(`
        INSERT INTO users(first_name, last_name, phone, email, password_hash, role_id, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING id, first_name, last_name, phone, email, is_active, created_at`,
      [firstName, lastName || null, phone || null, email, passwordHash, role.rows[0].id]);
      if (input.canManageCustomerPricing === true) {
        await CustomerManagementService.setManagerPermission({
          managerUserId: result.rows[0].id, enabled: true, grantedBy: createdBy,
        }, db);
      }
      return result.rows[0];
    });
  },

  async setActive(employeeId, isActive, db = pool) {
    const employee = id(employeeId);
    await assertManager(employee, db);
    const result = await db.query(`UPDATE users SET is_active = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING id, is_active`, [employee, isActive === true]);
    return result.rows[0];
  },

  async resetPassword(employeeId, password, db = pool) {
    const employee = id(employeeId);
    await assertManager(employee, db);
    const passwordHash = await bcrypt.hash(validatePassword(password), PASSWORD_SALT_ROUNDS);
    await db.query("UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [employee, passwordHash]);
    return { id: employee };
  },

  async setPricingPermission(employeeId, enabled, grantedBy, db = pool) {
    return CustomerManagementService.setManagerPermission({
      managerUserId: id(employeeId), enabled: enabled === true, grantedBy,
    }, db);
  },
};
