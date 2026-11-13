// Standalone retention maintenance; no EMAIL, HTTP or Telegram startup.
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
loadEnv({
  path: process.env.MAKA_RETENTION_ENV_FILE || fileURLToPath(new URL("../../.env", import.meta.url)),
  override: false,
  quiet: true,
});
if ((process.env.DATA_RETENTION_OWNER || "api") !== "dedicated") {
  throw new Error("Set DATA_RETENTION_OWNER=dedicated in both API and retention worker environments");
}
for (const key of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER"]) {
  if (!process.env[key]) throw new Error("Missing configuration key: " + key);
}
process.env.BACKGROUND_JOBS_ENABLED = "false";
process.env.EMAIL_IMPORT_SCHEDULER_ENABLED = "false";
process.env.DATA_RETENTION_ENABLED = "true";
const { startDataRetentionScheduler } = await import("../services/DataRetentionScheduler.js");
startDataRetentionScheduler();
console.log("MAKA DATA RETENTION ONLY STARTED");
setInterval(() => {}, 60_000);
