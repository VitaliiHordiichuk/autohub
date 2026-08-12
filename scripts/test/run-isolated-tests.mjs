import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";

import os from "node:os";
import path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  spawn,
} from "node:child_process";

import dotenv from "dotenv";
import pg from "pg";

import {
  SEARCH_FIXTURE,
} from "../../tests/helpers/search-fixture.js";


const { Pool } = pg;

const currentFile =
  fileURLToPath(import.meta.url);

const projectRoot =
  path.resolve(
    path.dirname(currentFile),
    "../.."
  );


dotenv.config({
  path: path.join(
    projectRoot,
    ".env"
  ),
});


function requiredEnv(name) {
  const value =
    String(
      process.env[name] ?? ""
    ).trim();

  if (!value) {
    throw new Error(
      `В .env не заполнено поле ${name}`
    );
  }

  return value;
}


const databaseConfig = {
  host:
    requiredEnv("DB_HOST"),

  port:
    Number(
      requiredEnv("DB_PORT")
    ),

  user:
    requiredEnv("DB_USER"),

  password:
    process.env.DB_PASSWORD ?? "",

  productionDatabase:
    requiredEnv("DB_NAME"),
};


if (
  !Number.isInteger(
    databaseConfig.port
  ) ||
  databaseConfig.port <= 0
) {
  throw new Error(
    "DB_PORT должен быть положительным целым числом"
  );
}


const testDatabase =
  String(
    process.env.TEST_DB_NAME ||
    `${databaseConfig.productionDatabase}_test`
  ).trim();


if (
  !testDatabase ||
  testDatabase ===
    databaseConfig.productionDatabase ||
  !/_test$/i.test(testDatabase)
) {
  throw new Error(
    "Защита остановила тесты: имя тестовой базы должно оканчиваться на _test и отличаться от рабочей базы"
  );
}


const postgresEnv = {
  ...process.env,
  PGPASSWORD:
    databaseConfig.password,
};


function databaseCliArgs() {
  return [
    "--host",
    databaseConfig.host,
    "--port",
    String(databaseConfig.port),
    "--username",
    databaseConfig.user,
  ];
}


function localAdminDatabaseCliArgs() {
  return [
    "--maintenance-db",
    "postgres",
  ];
}


function runCommand(
  command,
  args,
  {
    env = process.env,
    cwd = projectRoot,
  } = {}
) {
  return new Promise(
    (resolve, reject) => {
      const child = spawn(
        command,
        args,
        {
          cwd,
          env,
          stdio: "inherit",
        }
      );

      child.once(
        "error",
        (error) => {
          reject(
            new Error(
              `Не удалось запустить ${command}: ${error.message}`
            )
          );
        }
      );

      child.once(
        "exit",
        (code, signal) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(
            new Error(
              `${command} завершился с кодом ${code ?? "?"}${signal ? `, сигнал ${signal}` : ""}`
            )
          );
        }
      );
    }
  );
}


async function collectTestFiles(
  relativeDirectory
) {
  const result = [];
  const absoluteDirectory =
    path.join(
      projectRoot,
      relativeDirectory
    );

  async function walk(directory) {
    const entries =
      await readdir(
        directory,
        {
          withFileTypes: true,
        }
      );

    for (const entry of entries) {
      const absolutePath =
        path.join(
          directory,
          entry.name
        );

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith(
          ".test.js"
        )
      ) {
        result.push(
          path.relative(
            projectRoot,
            absolutePath
          )
        );
      }
    }
  }

  await walk(absoluteDirectory);

  return result;
}


async function applyPendingMigrations() {
  const pool = new Pool({
    host:
      databaseConfig.host,
    port:
      databaseConfig.port,
    database:
      testDatabase,
    user:
      databaseConfig.user,
    password:
      databaseConfig.password,
  });

  try {
    const appliedResult =
      await pool.query(
        "SELECT version FROM schema_migrations"
      );

    const applied = new Set(
      appliedResult.rows.map(
        (row) => row.version
      )
    );

    const migrationDirectory =
      path.join(
        projectRoot,
        "migrations"
      );

    const migrationFiles =
      (await readdir(migrationDirectory))
        .filter((fileName) =>
          fileName.endsWith(".sql")
        )
        .sort();

    for (const fileName of migrationFiles) {
      const version =
        fileName.slice(0, -4);

      const legacyVersion =
        version.split("_", 1)[0];

      if (
        applied.has(version) ||
        applied.has(legacyVersion)
      ) {
        continue;
      }

      console.log(
        `Применяю миграцию к тестовой базе: ${version}`
      );

      const sql =
        await readFile(
          path.join(
            migrationDirectory,
            fileName
          ),
          "utf8"
        );

      await pool.query(sql);
      applied.add(version);
    }
  } finally {
    await pool.end();
  }
}


async function ensureProduct(
  db,
  {
    article,
    articleNormalized,
    name,
    brandId,
    articleNoPrefix = null,
    articleBase = null,
    articleSuffix = null,
    articleSuffixLength = 0,
    variantType = "BASE",
    vehicleBrandId = null,
    productTypeId = null,
  }
) {
  const existing =
    await db.query(
      `
        SELECT id
        FROM products
        WHERE article_normalized = $1
        ORDER BY id
        LIMIT 1;
      `,
      [articleNormalized]
    );

  if (existing.rows[0]) {
    const productId =
      Number(existing.rows[0].id);

    await db.query(
      `
        UPDATE products
        SET
          brand_id = $2,
          article = $3,
          article_normalized = $4,
          article_no_prefix = $5,
          name = $6,
          is_active = TRUE,
          article_base = $7,
          article_suffix = $8,
          article_suffix_length = $9,
          variant_type = $10,
          vehicle_brand_id = $11,
          product_type_id = $12,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1;
      `,
      [
        productId,
        brandId,
        article,
        articleNormalized,
        articleNoPrefix,
        name,
        articleBase,
        articleSuffix,
        articleSuffixLength,
        variantType,
        vehicleBrandId,
        productTypeId,
      ]
    );

    return productId;
  }

  const inserted =
    await db.query(
      `
        INSERT INTO products (
          brand_id,
          article,
          article_normalized,
          article_no_prefix,
          name,
          is_active,
          article_base,
          article_suffix,
          article_suffix_length,
          variant_type,
          vehicle_brand_id,
          product_type_id
        )
        VALUES (
          $1, $2, $3, $4,
          $5, TRUE, $6, $7,
          $8, $9, $10, $11
        )
        RETURNING id;
      `,
      [
        brandId,
        article,
        articleNormalized,
        articleNoPrefix,
        name,
        articleBase,
        articleSuffix,
        articleSuffixLength,
        variantType,
        vehicleBrandId,
        productTypeId,
      ]
    );

  return Number(
    inserted.rows[0].id
  );
}


async function seedSearchFixture() {
  const pool = new Pool({
    host:
      databaseConfig.host,
    port:
      databaseConfig.port,
    database:
      testDatabase,
    user:
      databaseConfig.user,
    password:
      databaseConfig.password,
  });

  const db =
    await pool.connect();

  try {
    await db.query("BEGIN");

    let brandResult =
      await db.query(
        `
          SELECT id
          FROM brands
          WHERE LOWER(name) = LOWER($1)
          ORDER BY id
          LIMIT 1;
        `,
        ["Mercedes-Benz"]
      );

    if (!brandResult.rows[0]) {
      brandResult =
        await db.query(
          `
            INSERT INTO brands (
              name,
              is_active
            )
            VALUES ($1, TRUE)
            RETURNING id;
          `,
          ["Mercedes-Benz"]
        );
    } else {
      await db.query(
        `
          UPDATE brands
          SET is_active = TRUE
          WHERE id = $1;
        `,
        [brandResult.rows[0].id]
      );
    }

    const brandId =
      Number(brandResult.rows[0].id);

    const vehicleBrandResult =
      await db.query(
        `
          SELECT id
          FROM vehicle_brands
          WHERE LOWER(name) = LOWER($1)
          ORDER BY id
          LIMIT 1;
        `,
        ["Mercedes-Benz"]
      );

    const productTypeResult =
      await db.query(
        `
          SELECT id
          FROM product_types
          WHERE UPPER(name) = 'ORIGINAL'
          ORDER BY id
          LIMIT 1;
        `
      );

    const originalProductId =
      await ensureProduct(
        db,
        {
          article:
            SEARCH_FIXTURE.originalArticle,
          articleNormalized:
            SEARCH_FIXTURE.originalNormalized,
          articleNoPrefix:
            SEARCH_FIXTURE.originalWithoutPrefix,
          articleBase:
            SEARCH_FIXTURE.originalNormalized,
          articleSuffix: "",
          articleSuffixLength: 0,
          variantType: "BASE",
          name:
            "Тестовый масляный фильтр Mercedes",
          brandId,
          vehicleBrandId:
            vehicleBrandResult.rows[0]
              ? Number(
                  vehicleBrandResult.rows[0].id
                )
              : null,
          productTypeId:
            productTypeResult.rows[0]
              ? Number(
                  productTypeResult.rows[0].id
                )
              : null,
        }
      );

    const analogProductId =
      await ensureProduct(
        db,
        {
          article:
            SEARCH_FIXTURE.analogArticle,
          articleNormalized:
            SEARCH_FIXTURE.analogNormalized,
          name:
            "Тестовый аналог масляного фильтра",
          brandId,
          variantType: "BASE",
        }
      );

    await db.query(
      `
        UPDATE product_offers
        SET
          quantity = 0,
          is_available = FALSE,
          updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ANY($1::integer[]);
      `,
      [[
        originalProductId,
        analogProductId,
      ]]
    );

    const warehouseResult =
      await db.query(
        `
          INSERT INTO warehouses (
            name,
            city,
            type,
            supplier_id,
            delivery_days,
            pickup_available,
            shipping_available,
            is_active,
            priority
          )
          VALUES (
            $1, $2, 'OWN', NULL,
            0, TRUE, TRUE, TRUE, 1
          )
          RETURNING id;
        `,
        [
          SEARCH_FIXTURE.warehouseName,
          SEARCH_FIXTURE.warehouseCity,
        ]
      );

    const warehouseId =
      Number(
        warehouseResult.rows[0].id
      );

    const offerResult =
      await db.query(
        `
          INSERT INTO product_offers (
            product_id,
            warehouse_id,
            supplier_id,
            quantity,
            purchase_price,
            retail_price,
            delivery_days,
            is_available,
            source_type,
            price_mode,
            manual_retail_price,
            is_hidden,
            updated_at
          )
          VALUES (
            $1, $2, NULL, $3, $4,
            $5, 0, TRUE, 'OWN_STOCK',
            'MANUAL', $6, FALSE,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (
            product_id,
            warehouse_id
          )
          DO UPDATE SET
            supplier_id = NULL,
            quantity = EXCLUDED.quantity,
            purchase_price = EXCLUDED.purchase_price,
            retail_price = EXCLUDED.retail_price,
            delivery_days = 0,
            is_available = TRUE,
            source_type = 'OWN_STOCK',
            price_mode = 'MANUAL',
            manual_retail_price = EXCLUDED.manual_retail_price,
            is_hidden = FALSE,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id;
        `,
        [
          analogProductId,
          warehouseId,
          SEARCH_FIXTURE.quantity,
          SEARCH_FIXTURE.purchasePrice,
          SEARCH_FIXTURE.automaticRetailPrice,
          SEARCH_FIXTURE.manualRetailPrice,
        ]
      );

    await db.query(
      `
        DELETE FROM product_relations
        WHERE product_id = $1
          AND relation_type = 'ANALOG';
      `,
      [originalProductId]
    );

    await db.query(
      `
        INSERT INTO product_relations (
          product_id,
          related_product_id,
          relation_type
        )
        VALUES ($1, $2, 'ANALOG');
      `,
      [
        originalProductId,
        analogProductId,
      ]
    );

    const languageResult =
      await db.query(
        `
          UPDATE site_languages
          SET
            is_public_enabled = TRUE,
            is_default = TRUE
          WHERE code = 'uk'
          RETURNING code;
        `
      );

    if (!languageResult.rows[0]) {
      throw new Error(
        "В тестовой копии отсутствует язык uk"
      );
    }

    await db.query(
      `
        UPDATE site_languages
        SET is_default = FALSE
        WHERE code <> 'uk';
      `
    );

    await db.query("COMMIT");

    console.log(
      `Тестовые данные: товар ${originalProductId}, аналог ${analogProductId}, предложение ${offerResult.rows[0].id}`
    );
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}


async function main() {
  const temporaryDirectory =
    await mkdtemp(
      path.join(
        os.tmpdir(),
        "autohub-tests-"
      )
    );

  const dumpPath =
    path.join(
      temporaryDirectory,
      "autohub.dump"
    );

  try {
    console.log(
      "\n========== ИЗОЛИРОВАННАЯ ТЕСТОВАЯ БАЗА =========="
    );

    console.log(
      `Рабочая база: ${databaseConfig.productionDatabase}`
    );

    console.log(
      `Тестовая база: ${testDatabase}`
    );

    console.log(
      "Создаю локальный снимок рабочей базы. Рабочие данные не изменяются."
    );

    await runCommand(
      "pg_dump",
      [
        ...databaseCliArgs(),
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        dumpPath,
        databaseConfig.productionDatabase,
      ],
      {
        env: postgresEnv,
      }
    );

    console.log(
      "Создаю тестовую базу через локальную административную роль PostgreSQL."
    );

    await runCommand(
      "dropdb",
      [
        ...localAdminDatabaseCliArgs(),
        "--if-exists",
        "--force",
        testDatabase,
      ]
    );

    await runCommand(
      "createdb",
      [
        ...localAdminDatabaseCliArgs(),
        "--owner",
        databaseConfig.user,
        testDatabase,
      ]
    );

    await runCommand(
      "pg_restore",
      [
        ...databaseCliArgs(),
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        testDatabase,
        dumpPath,
      ],
      {
        env: postgresEnv,
      }
    );

    await applyPendingMigrations();

    await seedSearchFixture();

    const testFiles = [
      ...await collectTestFiles("src"),
      ...await collectTestFiles("tests"),
      "test-brand-admin.mjs",
      "test-mercedes-family.mjs",
    ].sort();

    console.log(
      `\nЗапускаю тестовые файлы: ${testFiles.length}`
    );

    await runCommand(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        ...testFiles,
      ],
      {
        env: {
          ...process.env,
          DB_NAME:
            testDatabase,
          NODE_ENV:
            "test",
          AUTO_TRANSLATION_ENABLED:
            "false",
          AUTH_COOKIE_SECURE:
            "false",
        },
      }
    );

    console.log(
      `\nВсе тесты прошли в базе ${testDatabase}.`
    );

    console.log(
      `Рабочая база ${databaseConfig.productionDatabase} не изменялась.`
    );
  } finally {
    await rm(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      }
    );
  }
}


main().catch((error) => {
  console.error(
    "\nОШИБКА ИЗОЛИРОВАННЫХ ТЕСТОВ:",
    error.message
  );

  process.exitCode = 1;
});
