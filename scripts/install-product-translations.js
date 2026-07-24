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
  productTranslationRouter,
} from "./routes/product-translation.routes.js";
`.trim();


const routeMount = `
app.use(
  "/api/admin/products",
  productTranslationRouter
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
      "product-translation.routes.js"
    )
  ) {
    const appAnchor =
      "export const app = express();";

    if (
      !source.includes(appAnchor)
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
      '"/api/admin/products"'
    )
  ) {
    const jsonAnchor =
      "app.use(express.json());";

    if (
      !source.includes(jsonAnchor)
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


async function installDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS
      product_translations (
        product_id BIGINT
          NOT NULL
          REFERENCES products(id)
          ON DELETE CASCADE,

        language_code VARCHAR(5)
          NOT NULL
          REFERENCES site_languages(code)
          ON DELETE CASCADE,

        name VARCHAR(500)
          NOT NULL,

        description TEXT,

        created_at TIMESTAMPTZ
          NOT NULL
          DEFAULT NOW(),

        updated_at TIMESTAMPTZ
          NOT NULL
          DEFAULT NOW(),

        PRIMARY KEY (
          product_id,
          language_code
        )
      )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      product_translations_name_idx
    ON product_translations
      USING GIN (
        to_tsvector(
          'simple',
          name
        )
      )
  `);

  /*
   * Existing imported names are currently
   * mostly Russian, so we preserve them as
   * the initial RU translation.
   */
  await pool.query(`
    INSERT INTO product_translations (
      product_id,
      language_code,
      name
    )
    SELECT
      p.id,
      'ru',
      p.name
    FROM products p
    WHERE
      p.name IS NOT NULL
      AND BTRIM(p.name) <> ''

    ON CONFLICT (
      product_id,
      language_code
    )
    DO NOTHING
  `);

  /*
   * Initial real translations for the
   * current test item HU718/5X.
   */
  await pool.query(`
    INSERT INTO product_translations (
      product_id,
      language_code,
      name
    )
    SELECT
      p.id,
      seed.language_code,
      seed.name
    FROM products p

    CROSS JOIN (
      VALUES
        (
          'uk',
          'Фільтр оливний'
        ),
        (
          'en',
          'Oil filter'
        )
    ) AS seed(
      language_code,
      name
    )

    WHERE
      p.article_normalized =
        'HU7185X'
      OR UPPER(
        REPLACE(
          REPLACE(
            REPLACE(
              p.article,
              '/',
              ''
            ),
            '-',
            ''
          ),
          ' ',
          ''
        )
      ) = 'HU7185X'

    ON CONFLICT (
      product_id,
      language_code
    )
    DO NOTHING
  `);
}


try {
  console.log(
    "1/2 Створюємо переклади товарів..."
  );

  await installDatabase();

  console.log(
    "2/2 Підключаємо API перекладів..."
  );

  await patchAppFile();

  console.log(
    "✅ Переклади товарів встановлено"
  );

  console.log(
    "   RU: збережено поточні назви"
  );

  console.log(
    "   HU718/5X UK: Фільтр оливний"
  );

  console.log(
    "   HU718/5X EN: Oil filter"
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
