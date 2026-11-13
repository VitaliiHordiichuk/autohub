import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertTxtUploadStage,
  TXT_UPLOAD_ROOT,
} from "./SpecialOrderTxtBrowserUploadService.js";

import {
  createAuditedStagePlan,
} from "./SpecialOrderAuditedStagePlanService.js";

import {
  assertIsolatedStageEnvironment,
  readTxtStageJob,
  transitionTxtStageJob,
} from "./SpecialOrderTxtStageJobService.js";

const BACK_ROOT = fileURLToPath(
  new URL("../../", import.meta.url)
);

const SECRET_FILE =
  "/home/ubuntu/maka-git-audit-20261109/" +
  "browser-test-db-password-20261110";

const PGDATA =
  "/home/ubuntu/maka-special-order/" +
  "isolated-pg16-20261105/data";

export const GLOBAL_STAGE_LOCK = join(
  TXT_UPLOAD_ROOT,
  ".mercedes-txt-global-stage.lock"
);

function jobMatchesPlan(job, plan) {
  return (
    job.fileId === plan.fileId &&
    job.sha256 === plan.sha256 &&
    job.expectedLines === plan.expectedLines &&
    job.expectedAccepted === plan.expectedAccepted &&
    job.expectedUniqueArticles ===
      plan.expectedUniqueArticles &&
    job.expectedPricingConflicts ===
      plan.expectedPricingConflicts &&
    plan.mode === "AUDITED_READY_FOR_ISOLATED_STAGE" &&
    plan.imported === false &&
    plan.activated === false
  );
}

function resultMatchesPlan(result, plan) {
  return (
    result?.mode === "STAGED_NOT_ACTIVATED" &&
    Number.isSafeInteger(result.importId) &&
    result.importId > 0 &&
    result.sourceSha256 === plan.sha256 &&
    result.totalLines === plan.expectedLines &&
    result.accepted === plan.expectedAccepted &&
    result.rejected ===
      plan.expectedLines - plan.expectedAccepted &&
    result.uniqueArticles === plan.expectedUniqueArticles &&
    result.pricingConflicts ===
      plan.expectedPricingConflicts
  );
}

function failureCode(error) {
  if (error?.message === "STAGE_BUSY") {
    return "STAGE_BUSY";
  }

  if (error?.message === "STAGE_RESULT_MISMATCH") {
    return "STAGE_RESULT_MISMATCH";
  }

  if (error?.message === "STAGE_PLAN_MISMATCH") {
    return "STAGE_PLAN_MISMATCH";
  }

  return "STAGE_EXECUTION_FAILED";
}

export async function executeIsolatedStage(fileId) {
  const password = (
    await readFile(SECRET_FILE, "utf8")
  ).trim();

  if (!/^[0-9a-f]{64}$/i.test(password)) {
    throw new Error("ISOLATED_DB_SECRET_INVALID");
  }

  // Never inherit the live backend database configuration.
  const env = {
    HOME: "/home/ubuntu",
    PATH: process.env.PATH || "/usr/bin:/bin",
    NODE_ENV: "test",
    DOTENV_CONFIG_PATH: "/dev/null",

    MAKA_TXT_UPLOAD_MODE: "ISOLATED_STAGE",
    MAKA_TXT_UPLOAD_ROOT: TXT_UPLOAD_ROOT,

    MAKA_TXT_STAGE_MODE: "ISOLATED_TEST",
    DB_HOST: "127.0.0.1",
    DB_PORT: "5545",
    DB_NAME: "maka_special_order_browser_test",
    DB_USER: "maka_txt_browser_stage",
    DB_PASSWORD: password,
    SPECIAL_ORDER_EXPECTED_PGDATA: PGDATA,
  };

  assertIsolatedStageEnvironment(env);

  const args = [
    "-n",
    "-E",
    "75",
    GLOBAL_STAGE_LOCK,
    process.execPath,
    join(BACK_ROOT, "scripts/stage-audited-mercedes-txt.mjs"),
    "--file-id",
    fileId,
    "--stage",
    "--confirm-isolated-stage",
    "I_CONFIRM_ISOLATED_TEST_DB",
  ];

  const child = spawn("flock", args, {
    cwd: BACK_ROOT,
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });

  let output = "";
  let outputTooLarge = false;

  child.stdout.setEncoding("utf8");

  child.stdout.on("data", chunk => {
    if (output.length + chunk.length > 1024 * 1024) {
      outputTooLarge = true;
      return;
    }

    output += chunk;
  });

  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  if (code === 75) {
    throw new Error("STAGE_BUSY");
  }

  if (code !== 0 || outputTooLarge) {
    throw new Error("STAGE_EXECUTION_FAILED");
  }

  try {
    return JSON.parse(output);
  } catch {
    throw new Error("STAGE_RESULT_MISMATCH");
  }
}

export async function runTxtStageJob(
  fileId,
  {
    environment = process.env,
    planFactory = createAuditedStagePlan,
    executeStage = executeIsolatedStage,
    heartbeatMs = 20000,
  } = {}
) {
  assertIsolatedStageEnvironment(environment);
  await assertTxtUploadStage();

  if (
    !Number.isSafeInteger(heartbeatMs) ||
    heartbeatMs < 10
  ) {
    throw new Error("INVALID_HEARTBEAT_INTERVAL");
  }

  const original = await readTxtStageJob(fileId);

  if (!original || original.status !== "QUEUED") {
    throw new Error("STAGE_JOB_NOT_QUEUED");
  }

  // This claim is deliberately permanent.
  // A crashed worker cannot silently retry an import.
  const claimFile = join(
    TXT_UPLOAD_ROOT,
    `${fileId}.txt.stage.claim.json`
  );

  try {
    await writeFile(
      claimFile,
      JSON.stringify({
        fileId,
        sourceKey: "mercedes-txt",
        claimedAt: new Date().toISOString(),
        pid: process.pid,
      }),
      { flag: "wx", mode: 0o600 }
    );
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error("STAGE_JOB_ALREADY_CLAIMED");
    }
    throw error;
  }

  try {
    const plan = await planFactory(fileId);

    if (!jobMatchesPlan(original, plan)) {
      throw new Error("STAGE_PLAN_MISMATCH");
    }

    await transitionTxtStageJob(
      fileId,
      "IMPORTING"
    );

    let heartbeatError = null;
    let heartbeatChain = Promise.resolve();

    const timer = setInterval(() => {
      heartbeatChain = heartbeatChain.then(async () => {
        if (heartbeatError) return;

        try {
          await transitionTxtStageJob(
            fileId,
            "IMPORTING"
          );
        } catch (error) {
          heartbeatError = error;
        }
      });
    }, heartbeatMs);

    let result;

    try {
      result = await executeStage(fileId, plan);
    } finally {
      clearInterval(timer);
      await heartbeatChain;
    }

    if (heartbeatError) {
      throw new Error("STAGE_HEARTBEAT_FAILED");
    }

    if (!resultMatchesPlan(result, plan)) {
      throw new Error("STAGE_RESULT_MISMATCH");
    }

    return await transitionTxtStageJob(
      fileId,
      "READY_NOT_ACTIVATED",
      {
        importId: result.importId,
        imported: true,
        activated: false,
        rejectionReasons: result.rejectionReasons || {},
      }
    );
  } catch (error) {
    // Do not retry automatically. A DB revision could already
    // have been created before an interruption.
    try {
      await transitionTxtStageJob(
        fileId,
        "FAILED",
        {
          imported: false,
          activated: false,
          errorCode: failureCode(error),
          requiresManualReview: true,
        }
      );
    } catch {
      // Preserve original error; manual review remains required.
    }

    throw error;
  }
}
