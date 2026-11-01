import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
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
    SELECT ep.user_id AS id FROM employee_profiles ep
    WHERE ep.user_id = $1 AND ep.staff_role = 'MANAGER'
      AND ep.removed_at IS NULL LIMIT 1`, [employeeId]);
  if (!result.rows[0]) throw new Error("Менеджер не найден");
}

async function audit(db, actorId, employeeId, action, before, after) {
  await db.query(
    "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,old_value,new_value) VALUES($1,$2,'EMPLOYEE',$3,$4,$5)",
    [actorId, action, employeeId, JSON.stringify(before ?? null), JSON.stringify(after ?? null)]);
}

async function revokeTelegram(db, employeeId) {
  await db.query("DELETE FROM makatron_staff_link_tokens WHERE user_id=$1", [employeeId]);
  await db.query("DELETE FROM makatron_staff_links WHERE user_id=$1", [employeeId]);
}

export const EmployeeAdminService = {
  async list(db = pool) {
    const result = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.phone, u.email,
             ep.access_enabled AS is_active, ep.created_at,
             ep.telegram_allowed, ep.order_notifications_enabled,
             (c.id IS NOT NULL) AS has_customer_profile,
             (l.user_id IS NOT NULL) AS telegram_connected,
             EXISTS(SELECT 1 FROM manager_permissions mp
               WHERE mp.user_id = u.id AND mp.permission_code = $1)
               AS can_manage_customer_pricing
      FROM employee_profiles ep JOIN users u ON u.id = ep.user_id
      LEFT JOIN customers c ON c.user_id = u.id
      LEFT JOIN makatron_staff_links l ON l.user_id = u.id
      WHERE ep.staff_role = 'MANAGER' AND ep.removed_at IS NULL
      ORDER BY ep.access_enabled DESC, ep.created_at DESC`, [CUSTOMER_PRICING_PERMISSION]);
    return result.rows;
  },

  async create(input, createdBy) {
    const mode = input.mode === "existing" ? "existing" : "new";
    const firstName = text(input.firstName);
    const lastName = text(input.lastName);
    const phone = text(input.phone).replace(/[^\d+]/g, "");
    const email = text(input.email).toLowerCase();
    const password = mode === "new" ? validatePassword(input.password) : null;
    if (mode === "new" && !firstName) throw new Error("Имя обязательно");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Некорректный email");

    return transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
      const existing = await db.query(`
        SELECT u.id, u.is_active, r.name AS role_name FROM users u
        JOIN roles r ON r.id=u.role_id WHERE LOWER(u.email)=$1
        FOR UPDATE OF u`, [email]);
      let userId;
      if (mode === "existing") {
        const user = existing.rows[0];
        if (!user || !user.is_active) throw new Error("Активний користувач не знайдений");
        if (input.userId && id(input.userId) !== Number(user.id)) {
          throw new Error("Email не відповідає вибраному користувачу");
        }
        if (user.role_name === "ADMIN") throw new Error("Адміністратора не можна додати як менеджера");
        userId = Number(user.id);
      } else {
        if (existing.rows.length) throw new Error("Акаунт уже існує. Оберіть призначення існуючого користувача");
        const role = await db.query("SELECT id FROM roles WHERE name = 'MANAGER' LIMIT 1");
        if (!role.rows[0]) throw new Error("Роль MANAGER не найдена");
        const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
        const result = await db.query(`
          INSERT INTO users(first_name,last_name,phone,email,password_hash,role_id,is_active)
          VALUES($1,$2,$3,$4,$5,$6,TRUE) RETURNING id`,
        [firstName,lastName || null,phone || null,email,passwordHash,role.rows[0].id]);
        userId = Number(result.rows[0].id);
      }
      const previous = await db.query(
        "SELECT staff_role,removed_at FROM employee_profiles WHERE user_id=$1 FOR UPDATE", [userId]);
      if (previous.rows[0]?.staff_role === "ADMIN" ||
          (previous.rows[0] && !previous.rows[0].removed_at)) {
        throw new Error("Користувач уже є співробітником");
      }
      await db.query(`
        INSERT INTO employee_profiles(user_id,staff_role,access_enabled,created_by)
        VALUES($1,'MANAGER',TRUE,$2)
        ON CONFLICT(user_id) DO UPDATE SET removed_at=NULL,removed_by=NULL,
          access_enabled=TRUE,telegram_allowed=FALSE,order_notifications_enabled=FALSE,
          staff_auth_version=employee_profiles.staff_auth_version+1,
          updated_at=CURRENT_TIMESTAMP`, [userId,createdBy]);
      if (input.canManageCustomerPricing === true) {
        await CustomerManagementService.setManagerPermission({
          managerUserId: userId, enabled: true, grantedBy: createdBy,
        }, db);
      }
      await audit(db,createdBy,userId,previous.rows[0]?"EMPLOYEE_REHIRED":"EMPLOYEE_CREATED",
        previous.rows[0],{mode,accessEnabled:true});
      const listed = await this.list(db);
      return listed.find((row) => Number(row.id) === userId);
    });
  },

  async setActive(employeeId, isActive, actorId) {
    const employee = id(employeeId);
    return transaction(async (db) => {
      await assertManager(employee, db);
      const before = await db.query("SELECT access_enabled FROM employee_profiles WHERE user_id=$1 FOR UPDATE",[employee]);
      const enabled = isActive === true;
      if (enabled) {
        const account = await db.query(`SELECT u.is_active,(c.id IS NOT NULL) AS has_customer
          FROM users u LEFT JOIN customers c ON c.user_id=u.id WHERE u.id=$1 FOR UPDATE OF u`,[employee]);
        if (!account.rows[0].is_active && account.rows[0].has_customer) {
          throw new Error("Клієнтський акаунт заблоковано окремо");
        }
        if (!account.rows[0].is_active) {
          await db.query("UPDATE users SET is_active=TRUE WHERE id=$1",[employee]);
        }
      }
      await db.query(`UPDATE employee_profiles SET access_enabled=$2,
        telegram_allowed=CASE WHEN $2 THEN telegram_allowed ELSE FALSE END,
        order_notifications_enabled=CASE WHEN $2 THEN order_notifications_enabled ELSE FALSE END,
        staff_auth_version=staff_auth_version+1,updated_at=CURRENT_TIMESTAMP
        WHERE user_id=$1`,[employee,enabled]);
      await db.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1",[employee]);
      if (!enabled) await revokeTelegram(db,employee);
      await audit(db,actorId,employee,enabled?"EMPLOYEE_ENABLED":"EMPLOYEE_DISABLED",
        {accessEnabled:before.rows[0].access_enabled},{accessEnabled:enabled});
      return {id:employee,is_active:enabled};
    });
  },

  async resetPassword(employeeId, password, actorId) {
    const employee = id(employeeId);
    return transaction(async (db) => {
      await assertManager(employee, db);
      const customer = await db.query("SELECT 1 FROM customers WHERE user_id=$1 LIMIT 1",[employee]);
      if (customer.rows.length) throw new Error("Пароль клієнтського акаунта тут змінювати не можна");
      const passwordHash = await bcrypt.hash(validatePassword(password), PASSWORD_SALT_ROUNDS);
      await db.query(`UPDATE users SET password_hash=$2,auth_version=auth_version+1,
        updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[employee,passwordHash]);
      await db.query(`UPDATE employee_profiles SET staff_auth_version=staff_auth_version+1,
        updated_at=CURRENT_TIMESTAMP WHERE user_id=$1`,[employee]);
      await audit(db,actorId,employee,"EMPLOYEE_PASSWORD_RESET",null,null);
      return {id:employee};
    });
  },

  async setPricingPermission(employeeId, enabled, grantedBy) {
    return transaction(async (db) => {
      const employee = id(employeeId);
      await assertManager(employee, db);
      const result = await CustomerManagementService.setManagerPermission({
        managerUserId:employee,enabled:enabled === true,grantedBy,
      },db);
      await audit(db,grantedBy,employee,"EMPLOYEE_CUSTOMER_PRICING_PERMISSION",
        null,{enabled:enabled === true});
      return result;
    });
  },

  async setTelegramAllowed(employeeId, enabled, actorId) {
    const employee = id(employeeId);
    return transaction(async (db) => {
      await assertManager(employee,db);
      const before = await db.query(
        "SELECT access_enabled,telegram_allowed FROM employee_profiles WHERE user_id=$1 FOR UPDATE",[employee]);
      if (enabled && !before.rows[0].access_enabled) throw new Error("Спочатку увімкніть доступ співробітника");
      await db.query(`UPDATE employee_profiles SET telegram_allowed=$2,
        order_notifications_enabled=CASE WHEN $2 THEN order_notifications_enabled ELSE FALSE END,
        updated_at=CURRENT_TIMESTAMP WHERE user_id=$1`,[employee,enabled === true]);
      if (!enabled) await revokeTelegram(db,employee);
      await audit(db,actorId,employee,"EMPLOYEE_TELEGRAM_PERMISSION",
        {allowed:before.rows[0].telegram_allowed},{allowed:enabled === true});
      return {id:employee,telegram_allowed:enabled === true};
    });
  },

  async setOrderNotifications(employeeId, enabled, actorId) {
    const employee = id(employeeId);
    return transaction(async (db) => {
      await assertManager(employee,db);
      const before = await db.query(`SELECT access_enabled,telegram_allowed,order_notifications_enabled
        FROM employee_profiles WHERE user_id=$1 FOR UPDATE`,[employee]);
      if (enabled && (!before.rows[0].access_enabled || !before.rows[0].telegram_allowed)) {
        throw new Error("Спочатку увімкніть доступ і службовий Telegram");
      }
      await db.query(`UPDATE employee_profiles SET order_notifications_enabled=$2,
        updated_at=CURRENT_TIMESTAMP WHERE user_id=$1`,[employee,enabled === true]);
      await db.query(`UPDATE makatron_staff_links SET notifications_enabled=$2
        WHERE user_id=$1`,[employee,enabled === true]);
      await audit(db,actorId,employee,"EMPLOYEE_ORDER_NOTIFICATIONS",
        {enabled:before.rows[0].order_notifications_enabled},{enabled:enabled === true});
      return {id:employee,order_notifications_enabled:enabled === true};
    });
  },

  async createTelegramLink(employeeId, actorId) {
    const employee = id(employeeId);
    return transaction(async (db) => {
      await assertManager(employee,db);
      const profile = await db.query(`SELECT access_enabled,telegram_allowed FROM employee_profiles
        WHERE user_id=$1 FOR UPDATE`,[employee]);
      if (!profile.rows[0].access_enabled || !profile.rows[0].telegram_allowed) {
        throw new Error("Службовий Telegram не дозволений");
      }
      const token = randomBytes(24).toString("hex");
      const hash = createHash("sha256").update(token).digest("hex");
      await db.query("DELETE FROM makatron_staff_link_tokens WHERE user_id=$1",[employee]);
      await db.query(`INSERT INTO makatron_staff_link_tokens(user_id,token_hash,expires_at)
        VALUES($1,$2,CURRENT_TIMESTAMP + INTERVAL '15 minutes')`,[employee,hash]);
      await audit(db,actorId,employee,"EMPLOYEE_TELEGRAM_LINK_ISSUED",null,{expiresInMinutes:15});
      return {url:"https://t.me/MAKA_com_ua_bot?start=staff_"+token,expiresInMinutes:15};
    });
  },

  async unlinkTelegram(employeeId, actorId) {
    const employee = id(employeeId);
    return transaction(async (db) => {
      await assertManager(employee,db);
      await revokeTelegram(db,employee);
      await audit(db,actorId,employee,"EMPLOYEE_TELEGRAM_UNLINKED",null,null);
      return {id:employee,telegram_connected:false};
    });
  },

  async resetWorkAccess(employeeId, actorId) {
    return this.setActive(employeeId,false,actorId);
  },

  async remove(employeeId, actorId) {
    const employee = id(employeeId);
    return transaction(async (db) => {
      await assertManager(employee,db);
      const before = await db.query(`SELECT ep.access_enabled, ep.telegram_allowed,
        ep.order_notifications_enabled,
        EXISTS(SELECT 1 FROM manager_permissions mp WHERE mp.user_id=ep.user_id) AS had_manager_permissions,
        EXISTS(SELECT 1 FROM makatron_staff_links l WHERE l.user_id=ep.user_id) AS had_staff_telegram_link
        FROM employee_profiles ep WHERE ep.user_id=$1 FOR UPDATE`,[employee]);
      await db.query(`UPDATE employee_profiles SET removed_at=CURRENT_TIMESTAMP,removed_by=$2,
        access_enabled=FALSE,telegram_allowed=FALSE,order_notifications_enabled=FALSE,
        staff_auth_version=staff_auth_version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$1`,
      [employee,actorId]);
      await db.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1",[employee]);
      await revokeTelegram(db,employee);
      await db.query("DELETE FROM manager_permissions WHERE user_id=$1",[employee]);
      await audit(db,actorId,employee,"EMPLOYEE_REMOVED",
        before.rows[0],{removed:true});
      return {id:employee,removed:true};
    });
  },
};
