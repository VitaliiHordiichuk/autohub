#!/usr/bin/env node

/*
 * Mercedes TXT production importer.
 *
 * Only special_order_* tables may be modified by
 * the underlying audited import service.
 *
 * No activation of the imported revision.
 * No automatic retries.
 */

import {
  assertProductionTxtStageEnvironment,
  assertProductionTxtDatabase,
} from "../src/services/SpecialOrderTxtProductionDatabaseGuard.js";

const args = process.argv.slice(2);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const checkOnly =
  args.length === 3 &&
  args[0] === "--check-only" &&
  args[1] === "--file-id";

const stage =
  args.length === 5 &&
  args[0] === "--stage" &&
  args[1] === "--file-id" &&
  args[3] === "--confirm-ready-only" &&
  args[4] === "I_CONFIRM_MAKA_READY_ONLY";

const fileId = args[2];

function refuse(code) {
  throw new Error(code);
}

async function main() {
  if ((!checkOnly && !stage) || !UUID.test(fileId || "")) {
    refuse("INVALID_PRODUCTION_IMPORT_ARGUMENTS");
  }

  // Validate environment BEFORE loading the database
  // pool or any service that might access a file.
  assertProductionTxtStageEnvironment();

  if (stage) {
    if (
      process.env.MAKA_TXT_PRODUCTION_IMPORT_ENABLED !== "true" ||
      process.env.MAKA_TXT_ACTIVATION_ENABLED !== "false"
    ) {
      refuse("PRODUCTION_TXT_IMPORT_NOT_APPROVED");
    }
  }

  if (!process.env.DB_PASSWORD) {
    refuse("PRODUCTION_DB_CREDENTIAL_NOT_CONFIGURED");
  }

  const [
    { pool },
    { createAuditedStagePlan },
    { stageSpecialOrderTxt },
  ] = await Promise.all([
    import("../src/config/db.js"),
    import("../src/services/SpecialOrderAuditedStagePlanService.js"),
    import("../src/services/SpecialOrderStageImportService.js"),
  ]);

  let client;

  try {
    client = await pool.connect();

    const identity = await assertProductionTxtDatabase(client);

    const plan = await createAuditedStagePlan(fileId);

    if (
      plan.fileId !== fileId ||
      plan.mode !== "AUDITED_READY_FOR_ISOLATED_STAGE" ||
      plan.imported !== false ||
      plan.activated !== false ||
      !UUID.test(plan.fileId) ||
      !/^[0-9a-f]{64}$/.test(plan.sha256 || "")
    ) {
      refuse("PRODUCTION_TXT_AUDIT_PLAN_INVALID");
    }

    const checkExisting = await client.query(
      `SELECT id, status
         FROM special_order_import_runs
        WHERE source_key = 'mercedes-txt'
          AND upload_file_id = $1::uuid`,
      [fileId]
    );

    if (checkExisting.rows.length !== 0) {
      refuse("PRODUCTION_TXT_UPLOAD_ALREADY_IMPORTED");
    }

    if (checkOnly) {
      console.log(JSON.stringify({
        mode: "PRODUCTION_CHECK_ONLY",
        database: identity.database,
        fileId: plan.fileId,
        sourceSha256: plan.sha256,
        totalLines: plan.expectedLines,
        accepted: plan.expectedAccepted,
        uniqueArticles: plan.expectedUniqueArticles,
        pricingConflicts: plan.expectedPricingConflicts,
        imported: false,
        activated: false,
      }, null, 2));

      return;
    }

    async function activePointer() {
      const result = await client.query(
        `SELECT active_import_id
           FROM special_order_sources
          WHERE source_key = 'mercedes-txt'`
      );

      return result.rows[0]?.active_import_id?.toString() ?? null;
    }

    const activeBefore = await activePointer();

    console.error(
      "PRODUCTION READY-ONLY IMPORT:",
      fileId,
      "lines:",
      plan.expectedLines
    );

    const result = await stageSpecialOrderTxt({
      client,
      filename: plan.filename,
      uploadFileId: plan.fileId,
      encoding: "windows-1251",
      expectedSha256: plan.sha256,
      expectedLines: plan.expectedLines,
      expectedAccepted: plan.expectedAccepted,
      expectedUniqueArticles: plan.expectedUniqueArticles,
      expectedPricingConflicts: plan.expectedPricingConflicts,
      onProgress: ({ lines, accepted }) => {
        console.error("IMPORTED:", lines, accepted);
      },
    });

    const verification = await client.query(
      `SELECT status,
              upload_file_id::text AS upload_file_id,
              source_sha256
         FROM special_order_import_runs
        WHERE id = $1`,
      [result.importId]
    );

    const row = verification.rows[0];
    const activeAfter = await activePointer();

    if (
      result.mode !== "STAGED_NOT_ACTIVATED" ||
      row?.status !== "READY" ||
      row?.upload_file_id !== fileId ||
      row?.source_sha256 !== plan.sha256 ||
      activeAfter !== activeBefore
    ) {
      refuse("PRODUCTION_TXT_POST_IMPORT_REVIEW_REQUIRED");
    }

    console.log(JSON.stringify({
      ...result,
      mode: "PRODUCTION_READY_NOT_ACTIVATED",
      activated: false,
    }, null, 2));
  } finally {
    client?.release();
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(
    "PRODUCTION TXT IMPORT REFUSED:",
    error?.message || "UNKNOWN_ERROR"
  );
  process.exitCode = 2;
}
