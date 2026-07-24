import "dotenv/config";

import {
  readFile,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
  resolve,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  pool,
} from "../src/config/db.js";


const currentFile =
  fileURLToPath(
    import.meta.url
  );

const projectRoot =
  resolve(
    dirname(currentFile),
    ".."
  );

const appPath =
  resolve(
    projectRoot,
    "src/app.js"
  );

const serverPath =
  resolve(
    projectRoot,
    "src/server.js"
  );


const routeImport = `
import adminAutomaticTranslationRoutes
  from "./routes/admin-automatic-translation.routes.js";
`.trim();


const routeMount = `
app.use(
  "/api/admin/automatic-translations",
  adminAutomaticTranslationRoutes
);
`.trim();


const schedulerImport = `
import {
  startAutomaticTranslationScheduler,
} from "./services/AutomaticTranslationScheduler.js";
`.trim();


async function patchAppFile() {
  let source =
    await readFile(
      appPath,
      "utf8"
    );

  if (
    !source.includes(
      "admin-automatic-translation.routes.js"
    )
  ) {
    const appAnchor =
      "export const app = express();";

    if (
      !source.includes(
        appAnchor
      )
    ) {
      throw new Error(
        "Не знайдено export const app = express(); у src/app.js"
      );
    }

    source =
      source.replace(
        appAnchor,
        `${routeImport}\n\n${appAnchor}`
      );
  }

  if (
    !source.includes(
      '"/api/admin/automatic-translations"'
    )
  ) {
    const jsonAnchor =
      "app.use(express.json());";

    if (
      !source.includes(
        jsonAnchor
      )
    ) {
      throw new Error(
        "Не знайдено app.use(express.json()); у src/app.js"
      );
    }

    source =
      source.replace(
        jsonAnchor,
        `${jsonAnchor}\n\n${routeMount}`
      );
  }

  await writeFile(
    appPath,
    source,
    "utf8"
  );
}


async function patchServerFile() {
  let source =
    await readFile(
      serverPath,
      "utf8"
    );

  if (
    !source.includes(
      "AutomaticTranslationScheduler.js"
    )
  ) {
    const firstImport =
      source.match(
        /^import[\s\S]*?;\s*/m
      );

    if (firstImport) {
      source =
        source.replace(
          firstImport[0],
          `${firstImport[0]}\n${schedulerImport}\n`
        );

    } else {
      source =
        `${schedulerImport}\n\n${source}`;
    }
  }

  if (
    !source.includes(
      "startAutomaticTranslationScheduler();"
    )
  ) {
    if (
      source.includes(
        "startEmailImportScheduler();"
      )
    ) {
      source =
        source.replace(
          "startEmailImportScheduler();",
          [
            "startEmailImportScheduler();",
            "startAutomaticTranslationScheduler();",
          ].join("\n")
        );

    } else {
      const listenIndex =
        source.indexOf(
          ".listen("
        );

      if (
        listenIndex === -1
      ) {
        source +=
          "\nstartAutomaticTranslationScheduler();\n";

      } else {
        const lineStart =
          source.lastIndexOf(
            "\n",
            listenIndex
          ) + 1;

        source =
          source.slice(
            0,
            lineStart
          ) +
          "startAutomaticTranslationScheduler();\n\n" +
          source.slice(
            lineStart
          );
      }
    }
  }

  await writeFile(
    serverPath,
    source,
    "utf8"
  );
}


async function installDatabase() {
  await pool.query(`
    ALTER TABLE product_translations
      ADD COLUMN IF NOT EXISTS
        provider VARCHAR(30)
        NOT NULL
        DEFAULT 'MANUAL'
  `);

  await pool.query(`
    ALTER TABLE product_translations
      ADD COLUMN IF NOT EXISTS
        source_language VARCHAR(10)
  `);

  await pool.query(`
    ALTER TABLE product_translations
      ADD COLUMN IF NOT EXISTS
        is_verified BOOLEAN
        NOT NULL
        DEFAULT FALSE
  `);

  /*
   * The first translation installer copied
   * products.name into RU. Mark matching rows
   * as imported source so the worker may replace
   * them when DeepL detects Ukrainian or another
   * language.
   */
  await pool.query(`
    UPDATE product_translations pt
    SET
      provider = 'IMPORT',
      source_language = NULL,
      is_verified = FALSE
    FROM products p
    WHERE
      pt.product_id = p.id
      AND pt.language_code = 'ru'
      AND pt.name = p.name
      AND pt.provider = 'MANUAL'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS
      translation_memory (
        id BIGSERIAL PRIMARY KEY,

        source_language VARCHAR(10)
          NOT NULL,

        source_text TEXT
          NOT NULL,

        source_text_normalized TEXT
          NOT NULL,

        target_language VARCHAR(10)
          NOT NULL,

        translated_text TEXT
          NOT NULL,

        provider VARCHAR(30)
          NOT NULL
          DEFAULT 'DEEPL',

        use_count INTEGER
          NOT NULL
          DEFAULT 0,

        created_at TIMESTAMPTZ
          NOT NULL
          DEFAULT NOW(),

        updated_at TIMESTAMPTZ
          NOT NULL
          DEFAULT NOW(),

        UNIQUE (
          source_language,
          source_text_normalized,
          target_language
        )
      )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      translation_memory_source_idx
    ON translation_memory (
      source_text_normalized
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS
      product_translation_jobs (
        product_id BIGINT PRIMARY KEY
          REFERENCES products(id)
          ON DELETE CASCADE,

        status VARCHAR(20)
          NOT NULL
          DEFAULT 'PENDING',

        attempt_count INTEGER
          NOT NULL
          DEFAULT 0,

        detected_source_language
          VARCHAR(10),

        billed_characters BIGINT
          NOT NULL
          DEFAULT 0,

        last_error TEXT,

        next_attempt_at TIMESTAMPTZ
          NOT NULL
          DEFAULT NOW(),

        completed_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ
          NOT NULL
          DEFAULT NOW(),

        updated_at TIMESTAMPTZ
          NOT NULL
          DEFAULT NOW(),

        CONSTRAINT
          product_translation_jobs_status_check
        CHECK (
          status IN (
            'PENDING',
            'PROCESSING',
            'COMPLETED',
            'FAILED'
          )
        )
      )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      product_translation_jobs_queue_idx
    ON product_translation_jobs (
      status,
      next_attempt_at,
      updated_at
    )
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION
      enqueue_product_translation()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO
        product_translation_jobs (
          product_id,
          status,
          attempt_count,
          last_error,
          next_attempt_at,
          completed_at,
          updated_at
        )
      VALUES (
        NEW.id,
        'PENDING',
        0,
        NULL,
        NOW(),
        NULL,
        NOW()
      )

      ON CONFLICT (product_id)
      DO UPDATE SET
        status = 'PENDING',
        attempt_count = 0,
        last_error = NULL,
        next_attempt_at = NOW(),
        completed_at = NULL,
        updated_at = NOW();

      RETURN NEW;
    END;
    $$
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS
      products_enqueue_translation
    ON products
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS
      products_enqueue_translation_insert
    ON products
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS
      products_enqueue_translation_update
    ON products
  `);

  await pool.query(`
    CREATE TRIGGER
      products_enqueue_translation_insert

    AFTER INSERT
    ON products

    FOR EACH ROW

    EXECUTE FUNCTION
      enqueue_product_translation()
  `);

  await pool.query(`
    CREATE TRIGGER
      products_enqueue_translation_update

    AFTER UPDATE OF name
    ON products

    FOR EACH ROW

    WHEN (
      OLD.name IS DISTINCT
        FROM NEW.name
    )

    EXECUTE FUNCTION
      enqueue_product_translation()
  `);

  await pool.query(`
    INSERT INTO
      product_translation_jobs (
        product_id,
        status,
        attempt_count,
        next_attempt_at
      )

    SELECT
      id,
      'PENDING',
      0,
      NOW()

    FROM products

    WHERE
      name IS NOT NULL
      AND BTRIM(name) <> ''

    ON CONFLICT (product_id)
    DO UPDATE SET
      status = 'PENDING',
      attempt_count = 0,
      last_error = NULL,
      next_attempt_at = NOW(),
      completed_at = NULL,
      updated_at = NOW()
  `);
}


try {
  console.log(
    "1/3 Створюємо чергу та пам'ять перекладів..."
  );

  await installDatabase();

  console.log(
    "2/3 Підключаємо API..."
  );

  await patchAppFile();

  console.log(
    "3/3 Підключаємо планувальник..."
  );

  await patchServerFile();

  console.log(
    "✅ Автоматичні переклади DeepL встановлено"
  );

  console.log(
    "   Нові товари автоматично потрапляють у чергу"
  );

  console.log(
    "   Прайс не блокується під час перекладу"
  );

  console.log(
    "   Переклади: UK / EN / RU"
  );

} catch (error) {
  console.error(
    "❌ Помилка встановлення:",
    error
  );

  process.exitCode = 1;

} finally {
  await pool.end();
}
