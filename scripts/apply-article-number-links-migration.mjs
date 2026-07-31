import {
  spawn,
} from "node:child_process";

import path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import dotenv from "dotenv";
import pg from "pg";


const { Pool } = pg;
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
  const value =
    String(
      process.env[name] ?? ""
    ).trim();

  if (!value) {
    throw new Error(
      `В .env не заполнено ${name}`
    );
  }

  return value;
}


function runPsql() {
  const migration =
    path.join(
      projectRoot,
      "migrations",
      "034_create_article_number_links.sql"
    );

  const env = {
    ...process.env,
  };

  delete env.PGHOST;
  delete env.PGUSER;
  delete env.PGPASSWORD;

  return new Promise(
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
          "--file",
          migration,
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
}


await runPsql();

const pool = new Pool({
  host: required("DB_HOST"),
  port: Number(required("DB_PORT")),
  database: required("DB_NAME"),
  user: required("DB_USER"),
  password:
    process.env.DB_PASSWORD ?? "",
});

try {
  await pool.query(
    "SELECT 1 FROM article_number_links LIMIT 1"
  );
  console.log(
    "Миграция 034 применена, доступ приложения проверен."
  );
} finally {
  await pool.end();
}
