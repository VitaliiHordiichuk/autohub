import path from "node:path";

import {
  spawn,
} from "node:child_process";

import dotenv from "dotenv";


dotenv.config({
  path: path.join(
    process.cwd(),
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


const databaseName =
  requiredEnv("DB_NAME");

const databasePort =
  Number(
    requiredEnv("DB_PORT")
  );


const rollbackSql = `
BEGIN;

DROP TABLE IF EXISTS
  search_event_results;

DROP TABLE IF EXISTS
  search_events;

DELETE FROM schema_migrations
WHERE version =
  '033_create_search_analytics';

COMMIT;
`;


function runPsql() {
  return new Promise(
    (resolve, reject) => {
      const child = spawn(
        "psql",
        [
          "--no-psqlrc",
          "--set",
          "ON_ERROR_STOP=1",
          "--port",
          String(databasePort),
          "--dbname",
          databaseName,
          "--command",
          rollbackSql,
        ],
        {
          cwd: process.cwd(),
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


await runPsql();

console.log(
  "Миграция 033 отменена."
);
