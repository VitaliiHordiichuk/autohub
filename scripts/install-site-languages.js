import "dotenv/config";

import {
  readFile,
  writeFile,
} from "node:fs/promises";

import {
  fileURLToPath,
} from "node:url";

import {
  dirname,
  resolve,
} from "node:path";

import {
  pool,
} from "../src/config/db.js";

const currentFile =
  fileURLToPath(import.meta.url);

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

const routeImport = `
import {
  siteLanguageRouter,
  adminSiteLanguageRouter,
} from "./routes/site-language.routes.js";
`.trim();

const routeMount = `
app.use(
  "/api/site/languages",
  siteLanguageRouter
);

app.use(
  "/api/admin/site-languages",
  adminSiteLanguageRouter
);
`.trim();

async function patchAppFile() {
  let source =
    await readFile(
      appPath,
      "utf8"
    );

  if (
    !source.includes(
      "site-language.routes.js"
    )
  ) {
    const appAnchor =
      "export const app = express();";

    if (
      !source.includes(appAnchor)
    ) {
      throw new Error(
        "Не знайдено рядок export const app = express(); у src/app.js"
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
      '"/api/site/languages"'
    )
  ) {
    const jsonAnchor =
      "app.use(express.json());";

    if (
      !source.includes(jsonAnchor)
    ) {
      throw new Error(
        "Не знайдено рядок app.use(express.json()); у src/app.js"
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

async function installDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS
      site_languages (
        code VARCHAR(5)
          PRIMARY KEY,

        native_name VARCHAR(80)
          NOT NULL,

        english_name VARCHAR(80)
          NOT NULL,

        is_public_enabled BOOLEAN
          NOT NULL
          DEFAULT FALSE,

        is_admin_enabled BOOLEAN
          NOT NULL
          DEFAULT TRUE,

        is_default BOOLEAN
          NOT NULL
          DEFAULT FALSE,

        sort_order INTEGER
          NOT NULL
          DEFAULT 100,

        created_at TIMESTAMPTZ
          NOT NULL
          DEFAULT NOW(),

        updated_at TIMESTAMPTZ
          NOT NULL
          DEFAULT NOW(),

        CONSTRAINT
          site_languages_default_public
          CHECK (
            NOT is_default
            OR is_public_enabled
          )
      )
  `);

  await pool.query(`
    INSERT INTO site_languages (
      code,
      native_name,
      english_name,
      is_public_enabled,
      is_admin_enabled,
      is_default,
      sort_order
    )
    VALUES
      (
        'uk',
        'Українська',
        'Ukrainian',
        TRUE,
        TRUE,
        FALSE,
        1
      ),
      (
        'en',
        'English',
        'English',
        TRUE,
        TRUE,
        FALSE,
        2
      ),
      (
        'ru',
        'Русский',
        'Russian',
        FALSE,
        TRUE,
        FALSE,
        3
      )
    ON CONFLICT (code)
    DO UPDATE SET
      native_name =
        EXCLUDED.native_name,
      english_name =
        EXCLUDED.english_name,
      updated_at = NOW()
  `);

  const defaultResult =
    await pool.query(`
      SELECT code
      FROM site_languages
      WHERE is_default = TRUE
      LIMIT 1
    `);

  if (!defaultResult.rows[0]) {
    await pool.query(`
      UPDATE site_languages
      SET
        is_default =
          CASE
            WHEN code = 'uk'
              THEN TRUE
            ELSE FALSE
          END,

        is_public_enabled =
          CASE
            WHEN code = 'uk'
              THEN TRUE
            ELSE is_public_enabled
          END,

        updated_at = NOW()
    `);
  }

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      site_languages_one_default_idx
    ON site_languages (
      (is_default)
    )
    WHERE is_default = TRUE
  `);
}

try {
  console.log(
    "1/2 Створюємо таблицю мов..."
  );

  await installDatabase();

  console.log(
    "2/2 Підключаємо API у src/app.js..."
  );

  await patchAppFile();

  console.log(
    "✅ Мови сайту встановлено"
  );

  console.log(
    "   UK: увімкнено, основна"
  );

  console.log(
    "   EN: увімкнено"
  );

  console.log(
    "   RU: приховано для клієнтів"
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
