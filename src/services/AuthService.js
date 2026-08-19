import jwt from "jsonwebtoken";

import { pool } from "../config/db.js";
import { logCustomerActivity } from "./CustomerActivityService.js";
import {
  hashPassword,
  verifyPassword,
} from "./PasswordSecurityService.js";

const TOKEN_EXPIRES_IN =
  process.env.AUTH_TOKEN_EXPIRES_IN || "7d";

function getJwtSecret() {
  const secret = process.env.AUTH_JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_JWT_SECRET відсутній або коротший за 32 символи"
    );
  }

  return secret;
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePhone(value) {
  return String(value || "")
    .trim()
    .replace(/[^\d+]/g, "");
}

function normalizeUkrainianPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  let normalized = digits;

  if (/^0\d{9}$/.test(digits)) {
    normalized = `38${digits}`;
  } else if (/^\d{9}$/.test(digits)) {
    normalized = `380${digits}`;
  }

  if (!/^380\d{9}$/.test(normalized)) {
    throw createError("Вкажіть український номер у форматі +380 XX XXX XX XX");
  }

  return `+${normalized}`;
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateRegistration({
  firstName,
  lastName,
  phone,
  email,
  password,
}) {
  if (!firstName) {
    throw createError("Ім’я є обов’язковим");
  }

  if (firstName.length > 100) {
    throw createError(
      "Ім’я не повинно бути довшим за 100 символів"
    );
  }

  if (lastName.length > 100) {
    throw createError(
      "Прізвище не повинно бути довшим за 100 символів"
    );
  }

  if (!phone) {
    throw createError("Телефон є обов’язковим");
  }

  if (!/^\+?\d{7,20}$/.test(phone)) {
    throw createError("Некоректний номер телефону");
  }

  if (!email) {
    throw createError("Email є обов’язковим");
  }

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw createError("Некоректний email");
  }

  if (password.length < 8) {
    throw createError(
      "Пароль повинен містити щонайменше 8 символів"
    );
  }

  if (password.length > 200) {
    throw createError("Пароль надто довгий");
  }
}

function validateProfile({ firstName, lastName, phone, email }) {
  if (!firstName) {
    throw createError("Ім’я є обов’язковим");
  }

  if (firstName.length > 100 || lastName.length > 100) {
    throw createError("Ім’я або прізвище надто довгі");
  }

  if (!phone) {
    throw createError("Телефон є обов’язковим");
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError("Некоректний email");
  }
}

function createToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      role: user.roleName,
      authVersion: Number(user.authVersion || 0),
      mustChangePassword: Boolean(user.mustChangePassword),
    },
    getJwtSecret(),
    {
      expiresIn: TOKEN_EXPIRES_IN,
      issuer: "autohub-backend",
      audience: "autohub-client",
    }
  );
}

function mapAuthResult(row) {
  return {
    user: {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      email: row.email,
      role: row.role_name,
      isActive: row.is_active,
      staffNumber: row.staff_number || null,
      mustChangePassword: Boolean(row.must_change_password),
      lastLoginAt: row.last_login_at || null,
    },
    customer: row.customer_id
      ? {
          id: row.customer_id,
          customerNumber: row.customer_number,
          customerType: row.customer_type,
          priceGroupId: row.price_group_id,
          priceGroupName: row.price_group_name,
          discountPercent:
            row.discount_percent === null
              ? null
              : Number(row.discount_percent),
        }
      : null,
  };
}

async function findAuthUserByEmail(
  email,
  db = pool
) {
  const sql = `
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.phone,
      u.email,
      u.password_hash,
      u.is_active,
      u.staff_number,
      u.must_change_password,
      u.last_login_at,
      u.auth_version,
      r.name AS role_name,
      c.id AS customer_id,
      c.customer_number,
      c.customer_type,
      c.price_group_id,
      pg.name AS price_group_name,
      pg.discount_percent
    FROM users u
    JOIN roles r
      ON r.id = u.role_id
    LEFT JOIN customers c
      ON c.user_id = u.id
    LEFT JOIN price_groups pg
      ON pg.id = c.price_group_id
    WHERE LOWER(u.email) = LOWER($1)
    LIMIT 1;
  `;

  const result = await db.query(sql, [email]);

  return result.rows[0] ?? null;
}

async function findAuthUserById(
  userId,
  db = pool
) {
  const sql = `
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.phone,
      u.email,
      u.password_hash,
      u.is_active,
      u.staff_number,
      u.must_change_password,
      u.last_login_at,
      u.auth_version,
      r.name AS role_name,
      c.id AS customer_id,
      c.customer_number,
      c.customer_type,
      c.price_group_id,
      pg.name AS price_group_name,
      pg.discount_percent
    FROM users u
    JOIN roles r
      ON r.id = u.role_id
    LEFT JOIN customers c
      ON c.user_id = u.id
    LEFT JOIN price_groups pg
      ON pg.id = c.price_group_id
    WHERE u.id = $1
    LIMIT 1;
  `;

  const result = await db.query(sql, [userId]);

  return result.rows[0] ?? null;
}

export const AuthService = {
  async register(input) {
    const firstName = normalizeText(
      input.firstName
    );
    const lastName = normalizeText(
      input.lastName
    );
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);
    const password = String(input.password || "");

    validateRegistration({
      firstName,
      lastName,
      phone,
      email,
      password,
    });

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingUser =
        await findAuthUserByEmail(email, client);

      if (existingUser) {
        throw createError(
          "Користувач із таким email уже існує",
          409
        );
      }

      const roleResult = await client.query(
        `
          SELECT id
          FROM roles
          WHERE name = 'CLIENT'
          LIMIT 1;
        `
      );

      const roleId = roleResult.rows[0]?.id;

      if (!roleId) {
        throw createError(
          "Роль CLIENT не знайдено",
          500
        );
      }

      const priceGroupResult =
        await client.query(
          `
            SELECT id
            FROM price_groups
            WHERE name = 'Registered'
            LIMIT 1;
          `
        );

      const priceGroupId =
        priceGroupResult.rows[0]?.id;

      if (!priceGroupId) {
        throw createError(
          "Цінову групу Registered не знайдено",
          500
        );
      }

      const passwordHash = await hashPassword(password);

      const userResult = await client.query(
        `
          INSERT INTO users (
            first_name,
            last_name,
            phone,
            email,
            password_hash,
            role_id,
            is_active
          )
          VALUES ($1, $2, $3, $4, $5, $6, TRUE)
          RETURNING id;
        `,
        [
          firstName,
          lastName || null,
          phone,
          email,
          passwordHash,
          roleId,
        ]
      );

      const userId = userResult.rows[0].id;

      const customerResult = await client.query(
        `
          INSERT INTO customers (
            user_id,
            customer_type,
            price_group_id,
            is_active
          )
          VALUES ($1, 'REGISTERED', $2, TRUE)
          RETURNING id, customer_number;
        `,
        [userId, priceGroupId]
      );

      await logCustomerActivity(client, {
        customerId: customerResult.rows[0].id,
        type: "REGISTERED",
        description: "Клієнт зареєструвався на сайті",
        actorUserId: userId,
        metadata: {
          customerNumber: customerResult.rows[0].customer_number,
        },
      });

      await client.query(
        `
          INSERT INTO user_delivery_profiles (
            user_id,
            recipient_first_name,
            recipient_last_name,
            recipient_phone,
            recipient_email,
            delivery_method
          )
          VALUES ($1, $2, $3, $4, $5, 'PICKUP')
          ON CONFLICT (user_id) DO NOTHING;
        `,
        [
          userId,
          firstName,
          lastName || null,
          phone,
          email,
        ]
      );

      const authUser =
        await findAuthUserById(userId, client);

      await client.query("COMMIT");

      const result = mapAuthResult(authUser);

      return {
        ...result,
        token: createToken({
          id: authUser.id,
          roleName: authUser.role_name,
          authVersion: authUser.auth_version,
          mustChangePassword: authUser.must_change_password,
        }),
      };
    } catch (error) {
      await client.query("ROLLBACK");

      if (error.code === "23505") {
        throw createError(
          "Користувач із таким email уже існує",
          409
        );
      }

      throw error;
    } finally {
      client.release();
    }
  },

  async login(input) {
    const email = normalizeEmail(input.email);
    const password = String(input.password || "");

    if (!email || !password) {
      throw createError(
        "Email і пароль є обов’язковими"
      );
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const authUser = await findAuthUserByEmail(email, client);

      if (!authUser) {
        throw createError("Неправильний email або пароль", 401);
      }

      if (!authUser.is_active) {
        throw createError("Користувача заблоковано", 403);
      }

      const passwordMatches = await verifyPassword(
        password,
        authUser.password_hash
      );

      if (!passwordMatches) {
        throw createError("Неправильний email або пароль", 401);
      }

      await client.query(
        `UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [authUser.id]
      );
      await logCustomerActivity(client, {
        customerId: authUser.customer_id,
        type: "LOGIN",
        description: "Клієнт увійшов до акаунта",
        actorUserId: authUser.id,
      });
      const refreshed = await findAuthUserById(authUser.id, client);
      await client.query("COMMIT");
      const result = mapAuthResult(refreshed);

      return {
        ...result,
        token: createToken({
          id: refreshed.id,
          roleName: refreshed.role_name,
          authVersion: refreshed.auth_version,
          mustChangePassword: refreshed.must_change_password,
        }),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async getCurrentUser(userId) {
    const authUser =
      await findAuthUserById(userId);

    if (!authUser || !authUser.is_active) {
      throw createError(
        "Користувача не знайдено або заблоковано",
        401
      );
    }

    return mapAuthResult(authUser);
  },

  async updateProfile(userId, input) {
    const firstName = normalizeText(input.firstName);
    const lastName = normalizeText(input.lastName);
    const phone = normalizeUkrainianPhone(input.phone);
    const email = normalizeEmail(input.email);

    validateProfile({ firstName, lastName, phone, email });

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const current = await findAuthUserById(userId, client);

      if (!current || !current.is_active) {
        throw createError("Користувача не знайдено або заблоковано", 401);
      }

      const duplicate = await client.query(
        `SELECT 1 FROM users WHERE LOWER(email)=LOWER($1) AND id<>$2 LIMIT 1`,
        [email, userId]
      );

      if (duplicate.rows.length) {
        throw createError("Користувач із таким email уже існує", 409);
      }

      const phoneChanged =
        String(current.phone || "").replace(/\D/g, "") !== phone.replace(/\D/g, "");

      await client.query(
        `UPDATE users SET
          first_name=$2,
          last_name=$3,
          phone=$4,
          email=$5,
          phone_verified_at=CASE WHEN $6 THEN NULL ELSE phone_verified_at END,
          phone_verified_value=CASE WHEN $6 THEN NULL ELSE phone_verified_value END
        WHERE id=$1`,
        [userId, firstName, lastName || null, phone, email, phoneChanged]
      );

      await client.query(
        `UPDATE user_delivery_profiles SET
          recipient_first_name=CASE WHEN recipient_first_name IS NOT DISTINCT FROM $2 THEN $6 ELSE recipient_first_name END,
          recipient_last_name=CASE WHEN recipient_last_name IS NOT DISTINCT FROM $3 THEN $7 ELSE recipient_last_name END,
          recipient_phone=CASE WHEN recipient_phone IS NOT DISTINCT FROM $4 THEN $8 ELSE recipient_phone END,
          recipient_email=CASE WHEN recipient_email IS NOT DISTINCT FROM $5 THEN $9 ELSE recipient_email END,
          updated_at=CURRENT_TIMESTAMP
        WHERE user_id=$1`,
        [
          userId,
          current.first_name,
          current.last_name,
          current.phone,
          current.email,
          firstName,
          lastName || null,
          phone,
          email,
        ]
      );

      const updated = await findAuthUserById(userId, client);
      await client.query("COMMIT");

      return {
        ...mapAuthResult(updated),
        phoneVerificationReset: phoneChanged,
      };
    } catch (error) {
      await client.query("ROLLBACK");

      if (error.code === "23505") {
        throw createError("Користувач із таким email уже існує", 409);
      }

      throw error;
    } finally {
      client.release();
    }
  },

  verifyToken(token) {
    return jwt.verify(token, getJwtSecret(), {
      issuer: "autohub-backend",
      audience: "autohub-client",
    });
  },

  async verifySessionToken(token) {
    const payload = this.verifyToken(token);
    const userId = Number(payload.sub);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw createError("Сесія недійсна", 401);
    }

    const result = await pool.query(
      `
        SELECT
          u.id,
          u.is_active,
          u.auth_version,
          u.must_change_password,
          r.name AS role_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1
        LIMIT 1;
      `,
      [userId]
    );
    const user = result.rows[0];
    const tokenVersion = Number(payload.authVersion || 0);

    if (
      !user ||
      !user.is_active ||
      Number(user.auth_version || 0) !== tokenVersion
    ) {
      throw createError("Сесія недійсна або завершилася", 401);
    }

    return {
      userId: Number(user.id),
      role: user.role_name,
      authVersion: Number(user.auth_version || 0),
      mustChangePassword: Boolean(user.must_change_password),
    };
  },

  async createSessionForUser(userId) {
    const authUser = await findAuthUserById(userId);

    if (!authUser || !authUser.is_active) {
      throw createError("Користувача не знайдено або заблоковано", 401);
    }

    return {
      ...mapAuthResult(authUser),
      token: createToken({
        id: authUser.id,
        roleName: authUser.role_name,
        authVersion: authUser.auth_version,
        mustChangePassword: authUser.must_change_password,
      }),
    };
  },
};
