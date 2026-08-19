import { pool } from "../config/db.js";
import { logCustomerActivity } from "./CustomerActivityService.js";
import { EmailService } from "./EmailService.js";
import {
  generateResetToken,
  generateTemporaryPassword,
  hashPassword,
  hashPrivateValue,
  hashSecret,
} from "./PasswordSecurityService.js";

const RESET_WINDOW_MINUTES = 15;
const RESET_LINK_MINUTES = 30;
const DEFAULT_RATE_LIMIT = 5;

function createError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeLocale(value) {
  return ["uk", "en", "ru"].includes(value) ? value : "uk";
}

function normalizeIdentifier(value) {
  const identifier = String(value || "").trim();
  if (identifier.includes("@")) return identifier.toLowerCase();
  return identifier.toUpperCase().replace(/\s+/g, "");
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw createError(`Некоректний ${label}`);
  }
  return id;
}

function publicUrl() {
  return String(process.env.FRONTEND_PUBLIC_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
}

function rateLimit() {
  const configured = Number(process.env.PASSWORD_RESET_RATE_LIMIT);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_RATE_LIMIT;
}

async function findCustomerByIdentifier(db, identifier) {
  const result = await db.query(
    `
      SELECT
        u.id AS user_id,
        u.first_name,
        u.email,
        c.id AS customer_id,
        c.customer_number
      FROM users u
      JOIN customers c ON c.user_id = u.id
      JOIN roles r ON r.id = u.role_id
      WHERE u.is_active = TRUE
        AND c.is_active = TRUE
        AND r.name = 'CLIENT'
        AND (
          LOWER(u.email) = LOWER($1)
          OR UPPER(c.customer_number) = UPPER($1)
        )
      LIMIT 1;
    `,
    [identifier]
  );

  return result.rows[0] || null;
}

async function sendResetEmailSafely(input) {
  try {
    return await EmailService.sendPasswordResetLink(input);
  } catch (error) {
    console.error("Password reset email error:", error.message);
    return { sent: false, error: error.code || "EMAIL_DELIVERY_FAILED" };
  }
}

export const PasswordResetService = {
  async requestReset({ identifier: rawIdentifier, locale, ipAddress }) {
    const identifier = normalizeIdentifier(rawIdentifier);
    const identifierHash = hashPrivateValue(identifier || "empty");
    const ipHash = ipAddress ? hashPrivateValue(ipAddress) : null;
    const language = normalizeLocale(locale);
    const client = await pool.connect();
    let emailPayload = null;

    try {
      await client.query("BEGIN");

      const recent = await client.query(
        `
          SELECT
            COUNT(*) FILTER (WHERE identifier_hash = $1) AS identifier_count,
            COUNT(*) FILTER (WHERE $2::char(64) IS NOT NULL AND ip_hash = $2) AS ip_count
          FROM password_reset_requests
          WHERE created_at > CURRENT_TIMESTAMP - ($3 * INTERVAL '1 minute');
        `,
        [identifierHash, ipHash, RESET_WINDOW_MINUTES]
      );
      const blocked =
        Number(recent.rows[0]?.identifier_count || 0) >= rateLimit() ||
        Number(recent.rows[0]?.ip_count || 0) >= rateLimit() * 3;

      if (!blocked) {
        await client.query(
          `INSERT INTO password_reset_requests(identifier_hash, ip_hash)
           VALUES($1, $2)`,
          [identifierHash, ipHash]
        );

        const customer = identifier
          ? await findCustomerByIdentifier(client, identifier)
          : null;

        if (customer) {
          const token = generateResetToken();
          const tokenHash = hashSecret(token);

          await client.query(
            `UPDATE password_reset_tokens
             SET used_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND used_at IS NULL`,
            [customer.user_id]
          );
          await client.query(
            `
              INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
              VALUES($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'));
            `,
            [customer.user_id, tokenHash, RESET_LINK_MINUTES]
          );
          await logCustomerActivity(client, {
            customerId: customer.customer_id,
            type: "PASSWORD_RESET_REQUESTED",
            description: "Клієнт запросив відновлення пароля",
            metadata: { locale: language },
            ipHash,
          });

          emailPayload = {
            to: customer.email,
            firstName: customer.first_name,
            locale: language,
            resetUrl: `${publicUrl()}/${language}/reset-password?token=${encodeURIComponent(token)}`,
          };
        }
      }

      await client.query(
        `DELETE FROM password_reset_requests
         WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days'`
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    if (emailPayload) await sendResetEmailSafely(emailPayload);

    return { success: true };
  },

  async resetWithToken({ token, password, ipAddress }) {
    const tokenHash = hashSecret(String(token || ""));
    const passwordHash = await hashPassword(password);
    const ipHash = ipAddress ? hashPrivateValue(ipAddress) : null;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `
          SELECT
            prt.id AS token_id,
            prt.user_id,
            c.id AS customer_id
          FROM password_reset_tokens prt
          JOIN users u ON u.id = prt.user_id
          LEFT JOIN customers c ON c.user_id = u.id
          WHERE prt.token_hash = $1
            AND prt.used_at IS NULL
            AND prt.expires_at > CURRENT_TIMESTAMP
            AND u.is_active = TRUE
          FOR UPDATE OF prt, u;
        `,
        [tokenHash]
      );
      const reset = result.rows[0];

      if (!reset) {
        throw createError(
          "Посилання недійсне або прострочене",
          400,
          "RESET_TOKEN_INVALID"
        );
      }

      await client.query(
        `
          UPDATE users
          SET
            password_hash = $2,
            must_change_password = FALSE,
            auth_version = auth_version + 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1;
        `,
        [reset.user_id, passwordHash]
      );
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND used_at IS NULL`,
        [reset.user_id]
      );
      await logCustomerActivity(client, {
        customerId: reset.customer_id,
        type: "PASSWORD_RESET_COMPLETED",
        description: "Клієнт створив новий пароль за одноразовим посиланням",
        metadata: { method: "RESET_LINK" },
        ipHash,
      });
      await client.query("COMMIT");
      return { success: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async changeForcedPassword({ userId, password, ipAddress }) {
    const id = positiveId(userId, "userId");
    const passwordHash = await hashPassword(password);
    const ipHash = ipAddress ? hashPrivateValue(ipAddress) : null;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `
          SELECT u.id, u.must_change_password, c.id AS customer_id
          FROM users u
          LEFT JOIN customers c ON c.user_id = u.id
          WHERE u.id = $1 AND u.is_active = TRUE
          FOR UPDATE OF u;
        `,
        [id]
      );
      const user = result.rows[0];

      if (!user) throw createError("Користувача не знайдено", 404);
      if (!user.must_change_password) {
        throw createError(
          "Примусова зміна пароля не потрібна",
          409,
          "PASSWORD_CHANGE_NOT_REQUIRED"
        );
      }

      await client.query(
        `
          UPDATE users
          SET
            password_hash = $2,
            must_change_password = FALSE,
            auth_version = auth_version + 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1;
        `,
        [id, passwordHash]
      );
      await logCustomerActivity(client, {
        customerId: user.customer_id,
        type: "TEMPORARY_PASSWORD_CHANGED",
        description: "Клієнт замінив тимчасовий пароль",
        actorUserId: id,
        metadata: { method: "FORCED_CHANGE" },
        ipHash,
      });
      await client.query("COMMIT");
      return { success: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async resetCustomerByStaff({
    customerId,
    actorUserId,
    actorRole,
    locale,
    ipAddress,
  }) {
    const id = positiveId(customerId, "customerId");
    const actorId = positiveId(actorUserId, "actorUserId");
    const role = String(actorRole || "").toUpperCase();

    if (!["ADMIN", "MANAGER"].includes(role)) {
      throw createError("Недостатньо прав", 403);
    }

    if (
      role === "MANAGER" &&
      !EmailService.isConfigured() &&
      process.env.EMAIL_DELIVERY_DISABLED !== "true"
    ) {
      throw createError(
        "Надсилання email не налаштоване. Зверніться до адміністратора.",
        503,
        "EMAIL_NOT_CONFIGURED"
      );
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const language = normalizeLocale(locale);
    const ipHash = ipAddress ? hashPrivateValue(ipAddress) : null;
    const client = await pool.connect();
    let customer;

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `
          SELECT
            c.id AS customer_id,
            c.customer_number,
            u.id AS user_id,
            u.first_name,
            u.email
          FROM customers c
          JOIN users u ON u.id = c.user_id
          WHERE c.id = $1 AND c.is_active = TRUE AND u.is_active = TRUE
          FOR UPDATE OF c, u;
        `,
        [id]
      );
      customer = result.rows[0];

      if (!customer) throw createError("Клієнта не знайдено", 404);

      await client.query(
        `
          UPDATE users
          SET
            password_hash = $2,
            must_change_password = TRUE,
            auth_version = auth_version + 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1;
        `,
        [customer.user_id, passwordHash]
      );
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND used_at IS NULL`,
        [customer.user_id]
      );
      await logCustomerActivity(client, {
        customerId: customer.customer_id,
        type: "PASSWORD_RESET_BY_STAFF",
        description: `${role === "ADMIN" ? "Адміністратор" : "Менеджер"} скинув пароль клієнта`,
        actorUserId: actorId,
        metadata: { actorRole: role },
        ipHash,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    let emailResult;
    try {
      emailResult = await EmailService.sendTemporaryPassword({
        to: customer.email,
        firstName: customer.first_name,
        locale: language,
        temporaryPassword,
      });
    } catch (error) {
      if (role === "MANAGER") {
        throw createError(
          "Пароль змінено, але email не доставлено. Повідомте адміністратора.",
          502,
          "EMAIL_DELIVERY_FAILED"
        );
      }
      emailResult = { sent: false, error: error.code || "EMAIL_DELIVERY_FAILED" };
    }

    return {
      customerNumber: customer.customer_number,
      temporaryPassword: role === "ADMIN" ? temporaryPassword : null,
      emailSent: emailResult?.sent === true,
    };
  },
};
