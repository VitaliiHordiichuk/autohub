import {
  readFile,
} from "node:fs/promises";

import path from "node:path";

import {
  spawn,
} from "node:child_process";

import dotenv from "dotenv";
import pg from "pg";


const { Client } = pg;

const projectRoot =
  process.cwd();


dotenv.config({
  path: path.join(
    projectRoot,
    ".env"
  ),
});


function requiredEnv(name) {
  const value = String(
    process.env[name] ?? ""
  ).trim();

  if (!value) {
    throw new Error(
      `В .env не заполнено поле ${name}`
    );
  }

  return value;
}


const migrationPath =
  path.join(
    projectRoot,
    "migrations",
    "033_create_search_analytics.sql"
  );


await readFile(
  migrationPath,
  "utf8"
);


const databaseName =
  requiredEnv("DB_NAME");

const databasePort =
  Number(
    requiredEnv("DB_PORT")
  );

if (
  !Number.isInteger(databasePort) ||
  databasePort <= 0
) {
  throw new Error(
    "DB_PORT должен быть положительным целым числом"
  );
}


function runPsql(args) {
  return new Promise(
    (resolve, reject) => {
      const child = spawn(
        "psql",
        args,
        {
          cwd: projectRoot,
          stdio: "inherit",
          env: {
            ...process.env,
            PGHOST: "",
            PGUSER: "",
            PGPASSWORD: "",
          },
        }
      );

      child.once(
        "error",
        (error) => {
          reject(
            new Error(
              `Не удалось запустить psql: ${error.message}`
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
              `psql завершился с кодом ${code ?? "?"}${signal ? `, сигнал ${signal}` : ""}`
            )
          );
        }
      );
    }
  );
}


console.log(
  "Применяю миграцию через локальную административную роль PostgreSQL."
);

await runPsql([
  "--no-psqlrc",
  "--set",
  "ON_ERROR_STOP=1",
  "--port",
  String(databasePort),
  "--dbname",
  databaseName,
  "--file",
  migrationPath,
]);


const applicationClient =
  new Client({
    host:
      process.env.DB_HOST,

    port:
      databasePort,

    database:
      databaseName,

    user:
      process.env.DB_USER,

    password:
      process.env.DB_PASSWORD,
  });


await applicationClient.connect();

try {
  await applicationClient.query(`
    SELECT id
    FROM search_events
    LIMIT 0;
  `);

  await applicationClient.query(`
    SELECT id
    FROM search_event_results
    LIMIT 0;
  `);
} finally {
  await applicationClient.end();
}


console.log(
  "Миграция 033 применена, доступ приложения проверен."
);
