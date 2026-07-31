import {
  spawn,
} from "node:child_process";

import path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import dotenv from "dotenv";


const currentFile =
  fileURLToPath(import.meta.url);
const projectRoot =
  path.resolve(
    path.dirname(currentFile),
    ".."
  );


dotenv.config({
  path: path.join(
    projectRoot,
    ".env"
  ),
});


function required(name) {
  const value = String(
    process.env[name] ?? ""
  ).trim();

  if (!value) {
    throw new Error(
      `В .env не заполнено ${name}`
    );
  }

  return value;
}


const sql = `
BEGIN;
DROP TABLE IF EXISTS article_number_links;
DELETE FROM schema_migrations
WHERE version = '034_create_article_number_links';
COMMIT;
`;

const env = {
  ...process.env,
};

delete env.PGHOST;
delete env.PGUSER;
delete env.PGPASSWORD;

await new Promise(
  (resolve, reject) => {
    const child = spawn(
      "psql",
      [
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--port",
        required("DB_PORT"),
        "--dbname",
        required("DB_NAME"),
        "--command",
        sql,
      ],
      {
        cwd: projectRoot,
        env,
        stdio: "inherit",
      }
    );

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `psql завершился с кодом ${code}`
        )
      );
    });
  }
);

console.log(
  "Миграция 034 отменена."
);
