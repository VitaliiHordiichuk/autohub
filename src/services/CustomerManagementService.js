import { pool } from "../config/db.js";
import { transaction } from "../db/transaction.js";
import { logCustomerActivity } from "./CustomerActivityService.js";
import { EmailService } from "./EmailService.js";
import {
  generateTemporaryPassword,
  hashPassword,
} from "./PasswordSecurityService.js";

export const CUSTOMER_PRICING_PERMISSION = "MANAGE_CUSTOMER_PRICING";
const CUSTOMER_NUMBER_PATTERN = /^MAKA-[0-9]{6}$/;

function createError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw createError(`Некоректний ${label}`);
  }
  return id;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
  return normalizeText(value).replace(/[^\d+]/g, "");
}

function normalizeCustomerNumber(value, { required = false } = {}) {
  const number = normalizeText(value).toUpperCase();

  if (!number && !required) return null;
  if (!CUSTOMER_NUMBER_PATTERN.test(number)) {
    throw createError("Номер клієнта повинен мати формат MAKA-001358");
  }

  return number;
}

function normalizeLocale(value) {
  return ["uk", "en", "ru"].includes(value) ? value : "uk";
}

async function nextAvailableCustomerNumber(db = pool) {
  const sequence = await db.query(
    "SELECT last_value, is_called FROM customer_number_seq"
  );
  let number = Number(sequence.rows[0]?.last_value || 1358);
  if (sequence.rows[0]?.is_called) number += 1;

  while (number <= 999999) {
    const candidate = `MAKA-${String(number).padStart(6, "0")}`;
    const exists = await db.query(
      "SELECT 1 FROM customers WHERE customer_number = $1 LIMIT 1",
      [candidate]
    );
    if (!exists.rows[0]) return candidate;
    number += 1;
  }

  throw createError("Діапазон номерів клієнтів вичерпано", 500);
}

async function ensureCustomerNumberAvailable(db, customerNumber, excludeId = null) {
  const duplicate = await db.query(
    `
      SELECT 1
      FROM customers
      WHERE customer_number = $1
        AND ($2::integer IS NULL OR id <> $2)
      LIMIT 1;
    `,
    [customerNumber, excludeId]
  );

  if (duplicate.rows[0]) {
    throw createError("Такий номер клієнта вже використовується", 409);
  }
}

async function getDefaultPriceGroup(db) {
  const result = await db.query(
    `SELECT id FROM price_groups WHERE name = 'Registered' LIMIT 1`
  );
  if (!result.rows[0]) {
    throw createError("Цінову групу Registered не знайдено", 500);
  }
  return Number(result.rows[0].id);
}

export const CustomerManagementService = {
  async hasPricingAccess(userId, role, db = pool) {
    if (role === "ADMIN") return true;
    if (role !== "MANAGER") return false;
    const result = await db.query(
      `SELECT 1 FROM manager_permissions
       WHERE user_id = $1 AND permission_code = $2 LIMIT 1`,
      [userId, CUSTOMER_PRICING_PERMISSION]
    );
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
    const digits = query.replace(/\D/g, "");
    const result = await db.query(
      `
        SELECT
          c.id,
          c.customer_number,
          c.company_name,
          c.customer_type,
          c.is_active,
          c.manager_note,
          c.created_at,
          u.id AS user_id,
          u.first_name,
          u.last_name,
          u.phone,
          u.email,
          u.last_login_at,
          u.must_change_password,
          pg.id AS price_group_id,
          pg.name AS price_group_name,
          pg.discount_percent,
          pg.pricing_mode
        FROM customers c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN price_groups pg ON pg.id = c.price_group_id
        WHERE (
          $1 = ''
          OR CONCAT_WS(
            ' ',
            c.customer_number,
            u.first_name,
            u.last_name,
            u.email,
            u.phone,
            c.company_name
          ) ILIKE '%' || $1 || '%'
          OR ($2 <> '' AND REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g') LIKE '%' || $2 || '%')
        )
        ORDER BY u.created_at DESC, c.id DESC
        LIMIT 500;
      `,
      [query, digits]
    );
    return result.rows;
  },

  async getNextCustomerNumber(db = pool) {
    return { customerNumber: await nextAvailableCustomerNumber(db) };
  },

  async createCustomer(input, actor) {
    const firstName = normalizeText(input.firstName);
    const lastName = normalizeText(input.lastName);
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);
    const companyName = normalizeText(input.companyName);
    const customerType = normalizeText(input.customerType || "REGISTERED").toUpperCase();
    const requestedNumber = normalizeCustomerNumber(input.customerNumber);
    const actorRole = String(actor.role || "").toUpperCase();
    const actorUserId = positiveId(actor.userId, "actorUserId");

    if (!["ADMIN", "MANAGER"].includes(actorRole)) {
      throw createError("Недостатньо прав", 403);
    }
    if (!firstName) throw createError("Ім’я є обов’язковим");
    if (!phone) throw createError("Телефон є обов’язковим");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw createError("Некоректний email");
    }
    if (!["REGISTERED", "VIP", "BUSINESS"].includes(customerType)) {
      throw createError("Некоректний тип клієнта");
    }
    if (
      actorRole === "MANAGER" &&
      !EmailService.isConfigured() &&
      process.env.EMAIL_DELIVERY_DISABLED !== "true"
    ) {
      throw createError(
        "Надсилання email не налаштоване. Зверніться до адміністратора.",
        503
      );
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const locale = normalizeLocale(input.locale);
    let created;

    try {
      created = await transaction(async (db) => {
        const duplicate = await db.query(
          "SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
          [email]
        );
        if (duplicate.rows[0]) {
          throw createError("Користувач із таким email уже існує", 409);
        }
        if (requestedNumber) {
          await ensureCustomerNumberAvailable(db, requestedNumber);
        }

        const roleResult = await db.query(
          "SELECT id FROM roles WHERE name = 'CLIENT' LIMIT 1"
        );
        if (!roleResult.rows[0]) throw createError("Роль CLIENT не знайдено", 500);
        const priceGroupId = input.priceGroupId
          ? positiveId(input.priceGroupId, "priceGroupId")
          : await getDefaultPriceGroup(db);

        const group = await db.query(
          "SELECT id FROM price_groups WHERE id = $1 LIMIT 1",
          [priceGroupId]
        );
        if (!group.rows[0]) throw createError("Цінову групу не знайдено", 404);

        const userResult = await db.query(
          `
            INSERT INTO users(
              first_name,
              last_name,
              phone,
              email,
              password_hash,
              role_id,
              is_active,
              must_change_password
            )
            VALUES($1, $2, $3, $4, $5, $6, TRUE, TRUE)
            RETURNING id;
          `,
          [
            firstName,
            lastName || null,
            phone,
            email,
            passwordHash,
            roleResult.rows[0].id,
          ]
        );
        const userId = Number(userResult.rows[0].id);
        const customerResult = await db.query(
          `
            INSERT INTO customers(
              user_id,
              customer_number,
              company_name,
              customer_type,
              price_group_id,
              is_active
            )
            VALUES($1, COALESCE($2, allocate_customer_number()), $3, $4, $5, TRUE)
            RETURNING id, customer_number;
          `,
          [userId, requestedNumber, companyName || null, customerType, priceGroupId]
        );
        const customer = customerResult.rows[0];

        await db.query(
          `
            INSERT INTO user_delivery_profiles(
              user_id,
              recipient_first_name,
              recipient_last_name,
              recipient_phone,
              recipient_email,
              delivery_method
            )
            VALUES($1, $2, $3, $4, $5, 'PICKUP')
            ON CONFLICT(user_id) DO NOTHING;
          `,
          [userId, firstName, lastName || null, phone, email]
        );
        await logCustomerActivity(db, {
          customerId: customer.id,
          type: "CREATED_BY_STAFF",
          description: `${actorRole === "ADMIN" ? "Адміністратор" : "Менеджер"} створив клієнта`,
          actorUserId,
          metadata: { customerNumber: customer.customer_number },
        });

        return {
          id: Number(customer.id),
          userId,
          customerNumber: customer.customer_number,
          email,
          firstName,
        };
      });
    } catch (error) {
      if (error.code === "23505") {
        throw createError("Email або номер клієнта вже використовується", 409);
      }
      throw error;
    }

    let emailSent = false;
    try {
      const delivery = await EmailService.sendTemporaryPassword({
        to: email,
        firstName,
        locale,
        temporaryPassword,
      });
      emailSent = delivery.sent === true;
    } catch (error) {
      if (actorRole === "MANAGER") {
        throw createError(
          "Клієнта створено, але email не доставлено. Повідомте адміністратора.",
          502,
          "EMAIL_DELIVERY_FAILED"
        );
      }
    }

    return {
      ...created,
      temporaryPassword: actorRole === "ADMIN" ? temporaryPassword : null,
      emailSent,
    };
  },

  async getCustomer(customerId, db = pool) {
    const id = positiveId(customerId, "customerId");
    const customerResult = await db.query(
      `
        SELECT
          c.id,
          c.customer_number,
          c.company_name,
          c.customer_type,
          c.is_active,
          c.manager_note,
          c.created_at,
          u.id AS user_id,
          u.first_name,
          u.last_name,
          u.phone,
          u.email,
          u.last_login_at,
          u.must_change_password,
          pg.id AS price_group_id,
          pg.name AS price_group_name,
          pg.discount_percent,
          pg.pricing_mode
        FROM customers c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN price_groups pg ON pg.id = c.price_group_id
        WHERE c.id = $1
        LIMIT 1;
      `,
      [id]
    );
    const customer = customerResult.rows[0];
    if (!customer) throw createError("Клієнта не знайдено", 404);

    const [orders, vins, history] = await Promise.all([
      db.query(
        `SELECT id, status, total_amount, created_at, updated_at, tracking_number
         FROM orders WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`,
        [id]
      ),
      db.query(
        `
          SELECT vr.vin, MAX(vr.created_at) AS last_request_at, COUNT(*)::integer AS request_count
          FROM vin_requests vr
          WHERE vr.user_id = $1
          GROUP BY vr.vin
          ORDER BY MAX(vr.created_at) DESC
          LIMIT 100;
        `,
        [customer.user_id]
      ),
      db.query(
        `
          SELECT
            ch.id,
            ch.type,
            ch.description,
            ch.metadata,
            ch.created_at,
            au.first_name AS actor_first_name,
            au.last_name AS actor_last_name,
            ar.name AS actor_role
          FROM customer_history ch
          LEFT JOIN users au ON au.id = ch.actor_user_id
          LEFT JOIN roles ar ON ar.id = au.role_id
          WHERE ch.customer_id = $1
          ORDER BY ch.created_at DESC, ch.id DESC
          LIMIT 200;
        `,
        [id]
      ),
    ]);

    return {
      customer,
      orders: orders.rows,
      vehicles: vins.rows,
      history: history.rows,
    };
  },

  async updateCustomerNumber({ customerId, customerNumber, changedBy }) {
    const id = positiveId(customerId, "customerId");
    const actorId = positiveId(changedBy, "changedBy");
    const number = normalizeCustomerNumber(customerNumber, { required: true });

    return transaction(async (db) => {
      await ensureCustomerNumberAvailable(db, number, id);
      const current = await db.query(
        "SELECT customer_number FROM customers WHERE id = $1 FOR UPDATE",
        [id]
      );
      if (!current.rows[0]) throw createError("Клієнта не знайдено", 404);
      const previous = current.rows[0].customer_number;

      await db.query(
        "UPDATE customers SET customer_number = $2 WHERE id = $1",
        [id, number]
      );
      await logCustomerActivity(db, {
        customerId: id,
        type: "CUSTOMER_NUMBER_CHANGED",
        description: `Номер клієнта змінено з ${previous} на ${number}`,
        actorUserId: actorId,
        metadata: { previous, current: number },
      });
      return { customerNumber: number };
    });
  },

  async setPriceGroup({ customerId, priceGroupId, changedBy }) {
    return transaction(async (db) => {
      const id = positiveId(customerId, "customerId");
      const groupId = positiveId(priceGroupId, "priceGroupId");
      const group = await db.query(
        "SELECT id, name FROM price_groups WHERE id = $1 LIMIT 1",
        [groupId]
      );
      if (!group.rows[0]) throw createError("Цінову групу не знайдено", 404);
      const result = await db.query(
        `UPDATE customers SET price_group_id = $2
         WHERE id = $1 AND is_active = TRUE RETURNING *`,
        [id, groupId]
      );
      if (!result.rows[0]) throw createError("Активного клієнта не знайдено", 404);
      await logCustomerActivity(db, {
        customerId: id,
        type: "PRICE_GROUP_CHANGED",
        description: `Цінову групу змінено на ${group.rows[0].name}`,
        actorUserId: positiveId(changedBy, "changedBy"),
        metadata: { priceGroupId: groupId, priceGroupName: group.rows[0].name },
      });
      return result.rows[0];
    });
  },

  async getManagers(db = pool) {
    const result = await db.query(
      `
        SELECT
          u.id,
          u.first_name,
          u.last_name,
          u.email,
          u.is_active,
          EXISTS(
            SELECT 1 FROM manager_permissions mp
            WHERE mp.user_id = u.id AND mp.permission_code = $1
          ) AS can_manage_customer_pricing
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE r.name = 'MANAGER'
        ORDER BY u.first_name, u.last_name, u.email;
      `,
      [CUSTOMER_PRICING_PERMISSION]
    );
    return result.rows;
  },

  async setManagerPermission({ managerUserId, enabled, grantedBy }, db = pool) {
    const id = positiveId(managerUserId, "managerUserId");
    const manager = await db.query(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND r.name = 'MANAGER' LIMIT 1`,
      [id]
    );
    if (!manager.rows[0]) throw createError("Менеджера не знайдено", 404);
    if (enabled) {
      await db.query(
        `
          INSERT INTO manager_permissions(user_id, permission_code, granted_by)
          VALUES($1, $2, $3)
          ON CONFLICT(user_id, permission_code)
          DO UPDATE SET granted_by = EXCLUDED.granted_by, created_at = CURRENT_TIMESTAMP;
        `,
        [id, CUSTOMER_PRICING_PERMISSION, grantedBy]
      );
    } else {
      await db.query(
        `DELETE FROM manager_permissions
         WHERE user_id = $1 AND permission_code = $2`,
        [id, CUSTOMER_PRICING_PERMISSION]
      );
    }
    return { managerUserId: id, enabled: Boolean(enabled) };
  },
};
