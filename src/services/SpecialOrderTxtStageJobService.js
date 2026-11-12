import { randomUUID } from "node:crypto";
import {
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  assertTxtUploadStage,
  TXT_UPLOAD_ROOT,
} from "./SpecialOrderTxtBrowserUploadService.js";

import {
  createAuditedStagePlan,
} from "./SpecialOrderAuditedStagePlanService.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STALE_AFTER_MS = 3 * 60 * 1000;

const TRANSITIONS = {
  QUEUED: ["IMPORTING", "FAILED"],
  IMPORTING: [
    "IMPORTING",
    "READY_NOT_ACTIVATED",
    "FAILED",
  ],
  READY_NOT_ACTIVATED: [],
  FAILED: [],
};

export function validTxtStageJobId(fileId) {
  return typeof fileId === "string" && UUID.test(fileId);
}

function jobFilename(fileId) {
  if (!validTxtStageJobId(fileId)) {
    throw new Error("INVALID_FILE_ID");
  }

  return join(TXT_UPLOAD_ROOT, `${fileId}.txt.stage.json`);
}

export function assertIsolatedStageEnvironment(
  env = process.env
) {
  const expectedData =
    "/home/ubuntu/maka-special-order/isolated-pg16-20261105/data";

  if (
    env.MAKA_TXT_STAGE_MODE !== "ISOLATED_TEST" ||
    env.MAKA_TXT_UPLOAD_MODE !== "ISOLATED_STAGE" ||
    env.MAKA_TXT_UPLOAD_ROOT !== TXT_UPLOAD_ROOT ||
    env.DB_HOST !== "127.0.0.1" ||
    env.DB_PORT !== "5545" ||
    env.DB_NAME !== "maka_special_order_browser_test" ||
    env.DB_USER !== "maka_txt_browser_stage" ||
    env.SPECIAL_ORDER_EXPECTED_PGDATA !== expectedData
  ) {
    throw new Error("ISOLATED_STAGE_ENVIRONMENT_REQUIRED");
  }
}

export async function readTxtStageJob(
  fileId,
  now = Date.now()
) {
  await assertTxtUploadStage();

  const filename = jobFilename(fileId);
  let data;

  try {
    data = JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  if (
    data.fileId !== fileId ||
    data.sourceKey !== "mercedes-txt" ||
    !Object.hasOwn(TRANSITIONS, data.status)
  ) {
    throw new Error("INVALID_STAGE_JOB_STATE");
  }

  if (
    ["QUEUED", "IMPORTING"].includes(data.status)
  ) {
    const last = Date.parse(
      data.updatedAt || data.createdAt || ""
    );

    if (
      !Number.isFinite(last) ||
      now - last > STALE_AFTER_MS
    ) {
      return {
        ...data,
        status: "INTERRUPTED_REVIEW_REQUIRED",
        requiresManualReview: true,
      };
    }
  }

  return data;
}

export async function reserveTxtStageJob(
  fileId,
  planFactory = createAuditedStagePlan
) {
  await assertTxtUploadStage();

  const filename = jobFilename(fileId);
  const plan = await planFactory(fileId);

  if (
    plan.fileId !== fileId ||
    plan.mode !== "AUDITED_READY_FOR_ISOLATED_STAGE" ||
    plan.imported !== false ||
    plan.activated !== false ||
    !/^[0-9a-f]{64}$/.test(plan.sha256 || "")
  ) {
    throw new Error("INVALID_STAGE_PLAN");
  }

  const now = new Date().toISOString();

  const job = {
    fileId,
    sourceKey: "mercedes-txt",
    status: "QUEUED",
    sha256: plan.sha256,
    expectedLines: plan.expectedLines,
    expectedAccepted: plan.expectedAccepted,
    expectedUniqueArticles: plan.expectedUniqueArticles,
    expectedPricingConflicts: plan.expectedPricingConflicts,
    imported: false,
    activated: false,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await writeFile(
      filename,
      JSON.stringify(job, null, 2),
      {
        flag: "wx",
        mode: 0o600,
      }
    );
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error("STAGE_JOB_ALREADY_EXISTS");
    }

    throw error;
  }

  return job;
}

export async function transitionTxtStageJob(
  fileId,
  nextStatus,
  extra = {}
) {
  await assertTxtUploadStage();

  const previous = await readTxtStageJob(fileId);

  if (!previous) {
    throw new Error("STAGE_JOB_NOT_FOUND");
  }

  const permitted =
    TRANSITIONS[previous.status] || [];

  if (!permitted.includes(nextStatus)) {
    throw new Error("INVALID_STAGE_JOB_TRANSITION");
  }

  const updated = {
    ...previous,
    ...extra,
    fileId,
    sourceKey: "mercedes-txt",
    status: nextStatus,
    createdAt: previous.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const filename = jobFilename(fileId);
  const temporary = `${filename}.${randomUUID()}.tmp`;

  try {
    await writeFile(
      temporary,
      JSON.stringify(updated, null, 2),
      {
        flag: "wx",
        mode: 0o600,
      }
    );

    await rename(temporary, filename);
  } finally {
    await unlink(temporary).catch(() => {});
  }

  return updated;
}
