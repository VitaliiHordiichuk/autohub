import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertTxtUploadStage,
  TXT_UPLOAD_ROOT,
} from "./SpecialOrderTxtBrowserUploadService.js";

import {
  assertProductionTxtStageEnvironment,
  assertProductionTxtDatabase,
} from "./SpecialOrderTxtProductionDatabaseGuard.js";

import {
  reserveTxtStageJob,
  transitionTxtStageJob,
  validTxtStageJobId,
} from "./SpecialOrderTxtStageJobService.js";

const BACK_ROOT = fileURLToPath(
  new URL("../../", import.meta.url)
);

// Normalize the known local hostname ONLY at the TXT boundary.
// The shared production DB identity guard remains unchanged.
function guardedProductionEnvironment(env = process.env) {
  return {
    ...env,
    DB_HOST:
      env.DB_HOST === "localhost"
        ? "127.0.0.1"
        : env.DB_HOST,
  };
}

export function assertProductionTxtLaunchEnabled(
  env = process.env
) {
  assertProductionTxtStageEnvironment(
    guardedProductionEnvironment(env)
  );

  if (
    env.MAKA_TXT_PRODUCTION_IMPORT_ENABLED !== "true" ||
    env.MAKA_TXT_ACTIVATION_ENABLED !== "false" ||
    typeof env.DB_PASSWORD !== "string" ||
    env.DB_PASSWORD.length === 0
  ) {
    throw new Error("PRODUCTION_TXT_IMPORT_DISABLED");
  }

  return true;
}

function workerEnvironment(env = process.env) {
  assertProductionTxtLaunchEnabled(env);

  const childEnv = {
    HOME: "/home/ubuntu",
    PATH: env.PATH || "/usr/bin:/bin",
    NODE_ENV: "production",
    DOTENV_CONFIG_PATH: "/dev/null",

    MAKA_TXT_STAGE_MODE: "PRODUCTION_READY_ONLY",
    MAKA_TXT_UPLOAD_MODE: "PRODUCTION_UPLOAD_ONLY",
    MAKA_TXT_UPLOAD_ROOT: TXT_UPLOAD_ROOT,
    MAKA_TXT_PRODUCTION_IMPORT_ENABLED: "true",
    MAKA_TXT_ACTIVATION_ENABLED: "false",

    DB_HOST: guardedProductionEnvironment(env).DB_HOST,
    DB_PORT: "5432",
    DB_NAME: "autohub",
    DB_USER: "autohub_app",
    DB_PASSWORD: env.DB_PASSWORD,
  };

  assertProductionTxtLaunchEnabled(childEnv);

  return childEnv;
}

async function verifyProductionDatabase(fileId) {
  // Importing the DB module does not connect by itself.
  // Load it only after the launch permission check.
  const { pool } = await import("../config/db.js");

  const client = await pool.connect();

  try {
    await assertProductionTxtDatabase(
      client,
      guardedProductionEnvironment()
    );

    const result = await client.query(
      `SELECT id
         FROM special_order_import_runs
        WHERE source_key = 'mercedes-txt'
          AND upload_file_id = $1::uuid
        LIMIT 1`,
      [fileId]
    );

    if (result.rows.length !== 0) {
      throw new Error(
        "PRODUCTION_TXT_UPLOAD_ALREADY_IMPORTED"
      );
    }
  } finally {
    client.release();
  }
}

export async function launchProductionTxtStageJob(
  fileId
) {
  // Refuse before connecting to DB or touching storage.
  assertProductionTxtLaunchEnabled();

  if (!validTxtStageJobId(fileId)) {
    throw new Error("INVALID_FILE_ID");
  }

  await assertTxtUploadStage();

  // Verify actual production DB identity before creating a job.
  await verifyProductionDatabase(fileId);

  // This creates an immutable QUEUED record using wx.
  // Reusing a file ID is not allowed.
  const job = await reserveTxtStageJob(fileId);

  const logPath = join(
    TXT_UPLOAD_ROOT,
    `${fileId}.txt.stage.log`
  );

  let fd;

  try {
    fd = openSync(logPath, "wx", 0o600);

    const child = spawn(
      process.execPath,
      [
        join(
          BACK_ROOT,
          "scripts/run-production-txt-stage-job.mjs"
        ),
        fileId,
      ],
      {
        cwd: BACK_ROOT,
        detached: true,
        stdio: ["ignore", fd, fd],
        env: workerEnvironment(),
      }
    );

    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    child.unref();

    return job;
  } catch {
    // A reserved job must not be silently recreated.
    await transitionTxtStageJob(
      fileId,
      "FAILED",
      {
        imported: false,
        activated: false,
        errorCode: "PRODUCTION_STAGE_LAUNCH_FAILED",
        requiresManualReview: true,
      }
    ).catch(() => {});

    throw new Error("PRODUCTION_STAGE_LAUNCH_FAILED");
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}
