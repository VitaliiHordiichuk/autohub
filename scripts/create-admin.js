import "dotenv/config";

import bcrypt from "bcryptjs";

import { pool } from "../src/config/db.js";

function requiredEnv(name) {
  const value = String(
    process.env[name] ?? ""
  ).trim();

  if (!value) {
    throw new Error(
      `Переменная ${name} обязательна`
    );
  }

  return value;
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

async function main() {
  const email = normalizeEmail(
    requiredEnv("ADMIN_EMAIL")
  );

  const password =
    requiredEnv("ADMIN_PASSWORD");

  const firstName =
    requiredEnv("ADMIN_FIRST_NAME");

  const lastName = String(
    process.env.ADMIN_LAST_NAME ?? ""
  ).trim();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email
    )
  ) {
    throw new Error("Некорректный email");
  }

  if (password.length < 10) {
    throw new Error(
      "Пароль администратора должен содержать минимум 10 символов"
    );
  }

  if (firstName.length > 100) {
    throw new Error(
      "Имя не должно быть длиннее 100 символов"
    );
  }

  if (lastName.length > 100) {
    throw new Error(
      "Фамилия не должна быть длиннее 100 символов"
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const roleResult =
      await client.query(`
        SELECT id
        FROM roles
        WHERE name = 'ADMIN'
        LIMIT 1;
      `);

    const roleId =
      roleResult.rows[0]?.id;

    if (!roleId) {
      throw new Error(
        "Роль ADMIN не найдена"
      );
    }

    const existingResult =
      await client.query(
        `
          SELECT id, email
          FROM users
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1;
        `,
        [email]
      );

    if (existingResult.rows[0]) {
      throw new Error(
        "Пользователь с таким email уже существует"
      );
    }

    const passwordHash =
      await bcrypt.hash(password, 12);

    const userResult =
      await client.query(
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
          VALUES (
            $1,
            $2,
            NULL,
            $3,
            $4,
            $5,
            TRUE
          )
          RETURNING
            id,
            first_name,
            last_name,
            email,
            is_active;
        `,
        [
          firstName,
          lastName || null,
          email,
          passwordHash,
          roleId,
        ]
      );

    await client.query("COMMIT");

    const user = userResult.rows[0];

    console.log(
      JSON.stringify(
        {
          success: true,
          user: {
            id: user.id,
            firstName:
              user.first_name,
            lastName:
              user.last_name,
            email: user.email,
            role: "ADMIN",
            isActive:
              user.is_active,
          },
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(
      `Ошибка создания администратора: ${error.message}`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
