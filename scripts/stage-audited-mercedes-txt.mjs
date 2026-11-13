#!/usr/bin/env node

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  createAuditedStagePlan,
} from "../src/services/SpecialOrderAuditedStagePlanService.js";

const BACK_ROOT = fileURLToPath(
  new URL("../", import.meta.url)
);

const APPROVED_PGDATA =
  "/home/ubuntu/maka-special-order/isolated-pg16-20261105/data";

function refuse(message) {
  console.error("REFUSED:", message);
  process.exit(2);
}

const args = process.argv.slice(2);

function value(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const fileId = value("--file-id");
const checkOnly = args.includes("--check-only");
const stage = args.includes("--stage");

if (
  !fileId ||
  checkOnly === stage ||
  args.some(arg =>
    ![
      "--file-id",
      fileId,
      "--check-only",
      "--stage",
      "--confirm-isolated-stage",
      "I_CONFIRM_ISOLATED_TEST_DB",
    ].includes(arg)
  )
) {
  refuse(
    "Use --file-id UUID with exactly one of " +
    "--check-only or --stage"
  );
}

if (stage) {
  if (
    value("--confirm-isolated-stage") !==
    "I_CONFIRM_ISOLATED_TEST_DB"
  ) {
    refuse("Explicit isolated staging confirmation required");
  }

  const env = process.env;

  if (
    !/_((preview)|(test))$/i.test(env.DB_NAME || "") ||
    env.DB_HOST !== "127.0.0.1" ||
    env.DB_PORT !== "5545" ||
    !env.DB_USER ||
    !env.DB_PASSWORD ||
    env.SPECIAL_ORDER_EXPECTED_PGDATA !== APPROVED_PGDATA ||
    env.MAKA_TXT_UPLOAD_MODE !== "ISOLATED_STAGE"
  ) {
    refuse("Isolated database environment is not approved");
  }

  if (realpathSync(APPROVED_PGDATA) !== APPROVED_PGDATA) {
    refuse("Isolated PostgreSQL directory mismatch");
  }
}

const plan = await createAuditedStagePlan(fileId);

if (checkOnly) {
  console.log(JSON.stringify({
    ...plan,
    note: "Read-only check. No database import was started.",
  }, null, 2));
  process.exit(0);
}

console.error(
  "STAGING ONLY:",
  plan.fileId,
  "lines=",
  plan.expectedLines
);

const cliArgs = [
  join(BACK_ROOT, "scripts/stage-special-order-txt.mjs"),
  "--file", plan.filename,
  "--upload-file-id", plan.fileId,
  "--encoding", "windows-1251",
  "--sha256", plan.sha256,
  "--expected-lines", String(plan.expectedLines),
  "--expected-accepted", String(plan.expectedAccepted),
  "--expected-unique", String(plan.expectedUniqueArticles),
  "--expected-conflicts", String(plan.expectedPricingConflicts),
  "--confirm-stage-only", "I_CONFIRM_ISOLATED_TEST_DB",
];

const child = spawn(
  process.execPath,
  cliArgs,
  {
    cwd: BACK_ROOT,
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      NODE_ENV: "test",
      DOTENV_CONFIG_PATH: "/dev/null",
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_NAME: process.env.DB_NAME,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      SPECIAL_ORDER_EXPECTED_PGDATA:
        process.env.SPECIAL_ORDER_EXPECTED_PGDATA,
    },
  }
);

let output = "";

child.stdout.setEncoding("utf8");
child.stdout.on("data", chunk => {
  output += chunk;
  if (output.length > 200000) {
    child.kill();
  }
});

const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});

if (code !== 0) {
  throw new Error(
    `Isolated staged import exited with code ${code}`
  );
}

const result = JSON.parse(output);

if (
  result.mode !== "STAGED_NOT_ACTIVATED" ||
  result.uploadFileId !== plan.fileId ||
  result.sourceSha256 !== plan.sha256 ||
  result.totalLines !== plan.expectedLines ||
  result.accepted !== plan.expectedAccepted ||
  result.uniqueArticles !== plan.expectedUniqueArticles ||
  result.pricingConflicts !== plan.expectedPricingConflicts
) {
  throw new Error("Staged import result differs from audit");
}

console.log(JSON.stringify(result, null, 2));
console.error("REVISION CREATED WITHOUT ACTIVATION");
