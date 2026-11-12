import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runMercedesTxtWorkerCore,
} from "./SpecialOrderTxtWorkerCoreService.js";

import {
  assertTxtUploadStage,
  TXT_UPLOAD_ROOT,
} from "./SpecialOrderTxtBrowserUploadService.js";

import {
  assertProductionTxtStageEnvironment,
} from "./SpecialOrderTxtProductionDatabaseGuard.js";

import {
  createAuditedStagePlan,
} from "./SpecialOrderAuditedStagePlanService.js";

import {
  validTxtStageJobId,
  readTxtStageJob,
  transitionTxtStageJob,
} from "./SpecialOrderTxtStageJobService.js";

const BACK_ROOT = fileURLToPath(
  new URL("../../", import.meta.url)
);

const LOCK = join(
  TXT_UPLOAD_ROOT,
  ".mercedes-txt-production-stage.lock"
);

function assertImportPermission() {
  assertProductionTxtStageEnvironment();

  if (
    process.env.MAKA_TXT_PRODUCTION_IMPORT_ENABLED !== "true" ||
    process.env.MAKA_TXT_ACTIVATION_ENABLED !== "false" ||
    !process.env.DB_PASSWORD
  ) {
    throw new Error("PRODUCTION_TXT_IMPORT_DISABLED");
  }
}

function matchesJob(job, plan) {
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

function matchesResult(result, plan) {
  return (
    result?.mode === "PRODUCTION_READY_NOT_ACTIVATED" &&
    result.activated === false &&
    Number.isSafeInteger(result.importId) &&
    result.importId > 0 &&
    result.sourceSha256 === plan.sha256 &&
    result.totalLines === plan.expectedLines &&
    result.accepted === plan.expectedAccepted &&
    result.rejected ===
      plan.expectedLines - plan.expectedAccepted &&
    result.uniqueArticles === plan.expectedUniqueArticles &&
    result.pricingConflicts === plan.expectedPricingConflicts
  );
}

function productionChildEnvironment() {
  const env = {
    HOME: "/home/ubuntu",
    PATH: process.env.PATH || "/usr/bin:/bin",
    NODE_ENV: "production",
    DOTENV_CONFIG_PATH: "/dev/null",

    MAKA_TXT_STAGE_MODE: "PRODUCTION_READY_ONLY",
    MAKA_TXT_UPLOAD_MODE: "PRODUCTION_UPLOAD_ONLY",
    MAKA_TXT_UPLOAD_ROOT: TXT_UPLOAD_ROOT,
    MAKA_TXT_PRODUCTION_IMPORT_ENABLED: "true",
    MAKA_TXT_ACTIVATION_ENABLED: "false",

    DB_HOST: process.env.DB_HOST,
    DB_PORT: "5432",
    DB_NAME: "autohub",
    DB_USER: "autohub_app",
    DB_PASSWORD: process.env.DB_PASSWORD,
  };

  assertProductionTxtStageEnvironment(env);
  return env;
}

async function executeProductionImport(fileId) {
  const child = spawn("flock", [
    "-n",
    "-E",
    "75",
    LOCK,
    process.execPath,
    join(BACK_ROOT, "scripts/stage-production-mercedes-txt.mjs"),
    "--stage",
    "--file-id",
    fileId,
    "--confirm-ready-only",
    "I_CONFIRM_MAKA_READY_ONLY",
  ], {
    cwd: BACK_ROOT,
    env: productionChildEnvironment(),
    stdio: ["ignore", "pipe", "inherit"],
  });

  let output = "";
  let oversized = false;

  child.stdout.setEncoding("utf8");

  child.stdout.on("data", chunk => {
    if (output.length + chunk.length > 1024 * 1024) {
      oversized = true;
      child.kill("SIGTERM");
      return;
    }

    output += chunk;
  });

  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  if (code === 75) {
    throw new Error("PRODUCTION_STAGE_BUSY");
  }

  if (code !== 0 || oversized) {
    throw new Error("PRODUCTION_STAGE_EXECUTION_FAILED");
  }

  try {
    return JSON.parse(output);
  } catch {
    throw new Error("PRODUCTION_STAGE_RESULT_INVALID");
  }
}

export async function runProductionTxtStageJob(
  fileId,
  { heartbeatMs = 20000 } = {}
) {
  // These checks must precede every filesystem action.
  assertImportPermission();

  if (!validTxtStageJobId(fileId)) {
    throw new Error("INVALID_FILE_ID");
  }

  if (
    !Number.isSafeInteger(heartbeatMs) ||
    heartbeatMs < 1000
  ) {
    throw new Error("INVALID_HEARTBEAT_INTERVAL");
  }

  await assertTxtUploadStage();

  const job = await readTxtStageJob(fileId);

  if (!job || job.status !== "QUEUED") {
    throw new Error("PRODUCTION_STAGE_JOB_NOT_QUEUED");
  }

  // The claim is intentionally permanent.
  // A crashed import must never retry automatically.
  const claim = join(
    TXT_UPLOAD_ROOT,
    `${fileId}.txt.stage.claim.json`
  );

  try {
    await writeFile(
      claim,
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
      throw new Error("PRODUCTION_STAGE_ALREADY_CLAIMED");
    }
    throw error;
  }

  return await runMercedesTxtWorkerCore({
    fileId,
    job,
    makePlan: createAuditedStagePlan,
    jobMatchesPlan: matchesJob,
    transitionJob: transitionTxtStageJob,
    executeImport: executeProductionImport,
    resultMatchesPlan: matchesResult,
    heartbeatMs,
  });
}
