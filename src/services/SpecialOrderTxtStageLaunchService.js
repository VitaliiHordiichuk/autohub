import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertTxtUploadStage,
  TXT_UPLOAD_ROOT,
} from "./SpecialOrderTxtBrowserUploadService.js";

import {
  assertIsolatedStageEnvironment,
  reserveTxtStageJob,
  transitionTxtStageJob,
} from "./SpecialOrderTxtStageJobService.js";

const BACK_ROOT = fileURLToPath(
  new URL("../../", import.meta.url)
);

function isolatedWorkerEnvironment() {
  return {
    HOME: "/home/ubuntu",
    PATH: process.env.PATH || "/usr/bin:/bin",
    NODE_ENV: "test",
    DOTENV_CONFIG_PATH: "/dev/null",

    MAKA_TXT_STAGE_MODE: "ISOLATED_TEST",
    MAKA_TXT_UPLOAD_MODE: "ISOLATED_STAGE",
    MAKA_TXT_UPLOAD_ROOT: TXT_UPLOAD_ROOT,

    DB_HOST: "127.0.0.1",
    DB_PORT: "5545",
    DB_NAME: "maka_special_order_browser_test",
    DB_USER: "maka_txt_browser_stage",

    SPECIAL_ORDER_EXPECTED_PGDATA:
      "/home/ubuntu/maka-special-order/" +
      "isolated-pg16-20261105/data",
  };
}

export async function launchTxtStageJob(fileId) {
  // Production/default environment must never launch this.
  assertIsolatedStageEnvironment();
  await assertTxtUploadStage();

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
          "scripts/run-audited-stage-job.mjs"
        ),
        fileId,
      ],
      {
        cwd: BACK_ROOT,
        detached: true,
        stdio: ["ignore", fd, fd],
        env: isolatedWorkerEnvironment(),
      }
    );

    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    child.unref();

    return job;
  } catch {
    await transitionTxtStageJob(
      fileId,
      "FAILED",
      {
        errorCode: "STAGE_LAUNCH_FAILED",
        requiresManualReview: true,
      }
    ).catch(() => {});

    throw new Error("STAGE_LAUNCH_FAILED");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
