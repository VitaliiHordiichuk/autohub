// Standalone MAKA warehouse-1 Gmail importer: newest full XLSX only.
// No HTTP, Telegram, TXT catalog or other background jobs are started.
import { config as loadEnv } from "dotenv";
import { createHash } from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const args = new Set(process.argv.slice(2));
const preview = args.has("--dry-run");
const serve = args.has("--serve");
const once = args.has("--once");
if (Number(preview) + Number(serve) + Number(once) !== 1) {
  throw new Error("Use exactly one: --dry-run, --once, or --serve");
}

loadEnv({
  path: process.env.MAKA_EMAIL_ENV_FILE || "/home/ubuntu/autohub/.env",
  quiet: true,
  override: false,
});

for (const key of [
  "GMAIL_USER", "GMAIL_APP_PASSWORD",
  "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD",
]) {
  if (!process.env[key]) throw new Error("Missing configuration key: " + key);
}
if (
  process.env.DB_NAME !== "autohub" ||
  Number(process.env.DB_PORT) !== 5432 ||
  !["127.0.0.1", "localhost", "::1"].includes(process.env.DB_HOST)
) {
  throw new Error("STOP: unexpected database target");
}

process.env.BACKGROUND_JOBS_ENABLED = "false";
process.env.EMAIL_IMPORT_SCHEDULER_ENABLED = "false";

const { pool } = await import("../config/db.js");
const { EmailImportRuleRepository } =
  await import("../repositories/EmailImportRuleRepository.js");
const { EmailImportFileRepository } =
  await import("../repositories/EmailImportFileRepository.js");
const { EmailImportStateRepository } =
  await import("../repositories/EmailImportStateRepository.js");
const { EmailImportService } = await import("../services/EmailImportService.js");
const { ImportFileParserService: fileParser } =
  await import("../services/ImportFileParserService.js");
const { parseImportNumber } =
  await import("../services/ImportNumericService.js");
const { privateCostSettings, assertPrivateCostColumn } =
  await import("../services/PrivateCostImportService.js");

const HOUR = 60 * 60 * 1000;
const MAX_MESSAGES = 500;
const MAX_MAIL_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

function info(message, details = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    message,
    ...details,
  }));
}

function emailAddresses(from) {
  return (from || [])
    .map(item => String(item?.address || "").trim().toLowerCase())
    .filter(Boolean);
}

function hasSender(from, address) {
  return emailAddresses(from).includes(address);
}

async function stateAndRule() {
  const state = await EmailImportStateRepository.findByAccount({
    accountKey: process.env.GMAIL_USER.trim().toLowerCase(),
    mailbox: "INBOX",
  });
  if (!state || !Number.isSafeInteger(Number(state.last_uid))) {
    throw new Error("Email import state is absent or invalid");
  }

  const rules = await EmailImportRuleRepository.findActive();
  if (
    rules.length !== 1 ||
    Number(rules[0].warehouse_supplier_import_id) !== 2 ||
    Number(rules[0].warehouse_id) !== 1
  ) {
    throw new Error("STOP: active import rules changed; refusing to skip other suppliers");
  }

  const rule = rules[0];
  if (
    String(rule.email_match_mode) !== "SENDER_ONLY" ||
    String(rule.pricing_model) !== "OWN_DUAL_PRICE" ||
    String(rule.warehouse_type).toUpperCase() !== "OWN" ||
    String(rule.supplier_type).toUpperCase() !== "OWN" ||
    !String(rule.email_from || "").trim()
  ) {
    throw new Error("STOP: warehouse-1 email profile differs from approved XLSX format");
  }

  const lastImport = await pool.query(
    "SELECT i.id, i.success_rows, e.attachment_sha256 " +
    "FROM imports i LEFT JOIN email_import_files e ON e.import_id=i.id " +
    "WHERE i.warehouse_id=1 AND i.import_method='EMAIL' " +
    "AND i.status='COMPLETED' AND COALESCE(i.error_rows,0)=0 AND i.success_rows>0 " +
    "ORDER BY i.created_at DESC, i.id DESC LIMIT 1"
  );
  const last = lastImport.rows[0];
  if (!last || Number(last.success_rows) < 4000) {
    throw new Error("STOP: last successful warehouse price unexpectedly small");
  }
  return { state, rule, last };
}

async function inspectFile(message, rule, previousRows) {
  const uid = Number(message.uid);
  if (Number(message.size || 0) > MAX_MAIL_BYTES) {
    throw new Error("STOP: latest email exceeds size guard");
  }

  const mail = await simpleParser(message.source);
  const sender = String(rule.email_from).trim().toLowerCase();
  if (!hasSender(mail.from?.value, sender)) {
    throw new Error("STOP: latest email sender does not match actual From header");
  }

  const supported = (mail.attachments || []).filter(a =>
    fileParser.detectFileType(a.filename)
  );
  if (
    supported.length !== 1 ||
    fileParser.detectFileType(supported[0].filename) !== "XLSX"
  ) {
    throw new Error("STOP: latest supplier email does not contain exactly one XLSX price");
  }
  const attachment = supported[0];
  if (!Buffer.isBuffer(attachment.content) ||
      attachment.content.length > MAX_FILE_BYTES) {
    throw new Error("STOP: XLSX attachment exceeds allowed size");
  }

  const rows = await fileParser.parseFileBuffer({
    buffer: attachment.content,
    fileType: "XLSX",
    startRow: rule.start_row,
  });
  const minRows = Math.floor(previousRows * 0.75);
  const maxRows = Math.ceil(previousRows * 1.5);
  if (rows.length < minRows || rows.length > maxRows) {
    throw new Error("STOP: file size differs excessively from prior price");
  }

  const columns = privateCostSettings(rule, {
    fileType: "XLSX", importMethod: "EMAIL",
  });
  if (Number(columns.internal_purchase_price_column) !== 6) {
    throw new Error("STOP: private cost column F was not enabled for own warehouse");
  }
  assertPrivateCostColumn(rows, columns);

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const cell = num => num ? row[Number(num) - 1] : null;
    const article = String(cell(rule.article_column) ?? "").trim();
    const name = String(cell(rule.name_column) ?? "").trim();
    if (!article || !name) {
      throw new Error("STOP: article or name absent at file row " + index);
    }
    for (const [field, col] of [
      ["quantity", rule.quantity_column],
      ["price", rule.price_column],
      ["retail price", rule.retail_price_column],
    ]) {
      if (!col) throw new Error("STOP: required XLSX column missing: " + field);
      parseImportNumber(cell(col), {
        fieldName: field,
        article,
        rowNumber: index + Number(rule.start_row),
      });
    }
  }
  return {
    uid,
    mail,
    attachment,
    rowCount: rows.length,
    sha256: createHash("sha256").update(attachment.content).digest("hex"),
  };
}

async function checkMailbox({ dryRun = false } = {}) {
  const { state, rule, last } = await stateAndRule();
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
    logger: false,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 30000,
  });
  let connected = false;
  let mailLock = null;
  try {
    await client.connect();
    connected = true;
    mailLock = await client.getMailboxLock("INBOX", { readOnly: true });
    if (!state.uid_validity ||
        String(client.mailbox?.uidValidity || "") !== String(state.uid_validity)) {
      throw new Error("STOP: Gmail UIDVALIDITY mismatch");
    }

    const highestUid = Math.max(0, Number(client.mailbox?.uidNext || 1) - 1);
    const since = dryRun ? Math.max(1, Number(state.last_uid) - 19) :
      Number(state.last_uid) + 1;
    let ids = [];
    if (since <= highestUid) {
      ids = await client.search({ uid: String(since) + ":" + highestUid }, { uid: true });
      ids = ids.map(Number).filter(uid => uid >= since).sort((a, b) => a - b);
    }
    if (ids.length > MAX_MESSAGES) {
      throw new Error("STOP: mailbox backlog exceeds 500 messages; manual review required");
    }
    if (!ids.length) {
      return {
        state, highestUid, matchingCount: 0,
        latest: null, last, skippedOlder: 0,
      };
    }

    const envelopes = await client.fetchAll(ids, {
      uid: true, envelope: true, size: true,
    }, { uid: true });
    const sender = String(rule.email_from).trim().toLowerCase();
    const matching = envelopes
      .filter(e => hasSender(e.envelope?.from, sender))
      .sort((a, b) => Number(a.uid) - Number(b.uid));
    if (!matching.length) {
      return {
        state, highestUid, matchingCount: 0,
        latest: null, last, skippedOlder: 0,
      };
    }

    const picked = matching[matching.length - 1];
    const full = await client.fetchOne(Number(picked.uid), {
      uid: true, source: true, size: true,
    }, { uid: true });
    if (!full?.source) throw new Error("STOP: latest supplier email unavailable");

    const latest = await inspectFile({
      uid: picked.uid, size: picked.size, source: full.source,
    }, rule, Number(last.success_rows));

    return {
      state, rule, last, highestUid, latest,
      matchingCount: matching.length,
      skippedOlder: Math.max(0, matching.length - 1),
    };
  } finally {
    if (mailLock) mailLock.release();
    if (connected) await client.logout().catch(() => {});
  }
}

async function claimLatest(rule, latest) {
  const data = {
    warehouseSupplierImportId: Number(rule.warehouse_supplier_import_id),
    supplierImportSettingsId: Number(rule.supplier_import_settings_id),
    emailMessageId: String(latest.mail.messageId || "").trim() ||
      ("gmail-uid:" + latest.uid),
    emailUid: latest.uid,
    emailFrom: emailAddresses(latest.mail.from?.value)[0] || null,
    emailSubject: latest.mail.subject || null,
    attachmentName: latest.attachment.filename || "",
    attachmentSha256: latest.sha256,
    receivedAt: latest.mail.date || null,
  };
  let record = await EmailImportFileRepository.findExact({
    warehouseSupplierImportId: data.warehouseSupplierImportId,
    emailMessageId: data.emailMessageId,
    attachmentSha256: data.attachmentSha256,
  });
  if (record?.status === "FAILED" && Number(record.attempt_count) < 5) {
    record = await EmailImportFileRepository.retryFailed(record.id);
  } else if (record) {
    throw new Error("STOP: latest attachment previously claimed; manual recovery required");
  } else {
    record = await EmailImportFileRepository.createProcessing(data);
  }
  if (!record || record.status !== "PROCESSING") {
    throw new Error("STOP: unable to claim latest price file");
  }
  return record;
}

async function oneCycle({ dryRun = false } = {}) {
  let db;
  let locked = false;
  let state;
  let started = false;
  try {
    // Same advisory-lock keys as EmailImportService.processMailbox().
    if (!dryRun) {
      db = await pool.connect();
      const lock = await db.query(
        "SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked",
        ["autohub", "email-import"]
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) {
        info("SKIP_LOCKED_BY_ANOTHER_IMPORTER");
        return;
      }
    }

    if (!dryRun) {
      state = await EmailImportStateRepository.findByAccount({
        accountKey: process.env.GMAIL_USER.trim().toLowerCase(),
        mailbox: "INBOX",
      });
      if (!state) throw new Error("STOP: email import state absent");
      await EmailImportStateRepository.markStarted({
        id: state.id,
        source: "SCHEDULER",
      });
      started = true;
    }

    const data = await checkMailbox({ dryRun });
    state = data.state;
    info("MAILBOX_CHECK", {
      dryRun,
      lastUid: Number(state.last_uid),
      highestUid: data.highestUid,
      matchingMessages: data.matchingCount,
      skippedOlder: data.skippedOlder,
      selectedUid: data.latest?.uid || null,
      selectedRows: data.latest?.rowCount || null,
    });
    if (dryRun) {
      info("DRY_RUN_PASS_NO_DATABASE_WRITES");
      return;
    }

    const summary = {
      status: "COMPLETED",
      source: "SCHEDULER",
      newMessages: data.matchingCount,
      importedFiles: 0,
      importedRows: 0,
      failedFiles: 0,
      skippedOlderFiles: data.skippedOlder,
      selectedUid: data.latest?.uid || null,
    };

    if (data.latest) {
      if (
        data.last.attachment_sha256 &&
        data.latest.sha256 === data.last.attachment_sha256
      ) {
        info("SKIP_SAME_PRICE_AS_LATEST_SUCCESSFUL_IMPORT", {
          uid: data.latest.uid,
        });
        summary.duplicateFiles = 1;
      } else {
        const record = await claimLatest(data.rule, data.latest);
        let imported;
        try {
          imported = await EmailImportService.importAttachment(
            data.rule, data.latest.attachment
          );
          await EmailImportFileRepository.markCompleted({
            id: record.id,
            importId: imported.result.importId,
          });
        } catch (error) {
          await EmailImportFileRepository.markFailed({
            id: record.id,
            errorMessage: error.message,
          }).catch(() => {});
          throw error;
        }

        if (
          Number(imported.result.successRows) !== data.latest.rowCount ||
          Number(imported.result.errors) !== 0
        ) {
          throw new Error(
            "STOP: import committed with row errors; investigate before advancing UID"
          );
        }

        summary.importedFiles = 1;
        summary.importedRows = Number(imported.result.successRows);
        summary.importId = Number(imported.result.importId);
        info("LATEST_PRICE_IMPORTED", {
          uid: data.latest.uid,
          importId: summary.importId,
          rows: summary.importedRows,
        });
      }
    }

    await EmailImportStateRepository.markSucceeded({
      id: state.id,
      lastUid: data.highestUid,
      result: summary,
    });
    info("CYCLE_COMPLETED", {
      newUid: data.highestUid,
      importedFiles: summary.importedFiles,
      skippedOlder: summary.skippedOlderFiles,
    });
  } catch (error) {
    const message = String(error?.message || error).slice(0,300);
    info("CYCLE_FAILED", { error: message });
    if (state && started && !dryRun) {
      await EmailImportStateRepository.markFailed({
        id: state.id,
        errorMessage: message,
        result: { status: "FAILED", worker: "maka-latest-email-price-worker" },
      }).catch(() => {});
    }
    if (!serve) process.exitCode = 1;
  } finally {
    if (db) {
      if (locked) {
        await db.query(
          "SELECT pg_advisory_unlock(hashtext($1), hashtext($2))",
          ["autohub", "email-import"]
        ).catch(() => {});
      }
      db.release();
    }
  }
}

if (serve) {
  info("LATEST_ONLY_EMAIL_WORKER_STARTED", { intervalMinutes: 60 });
  let active = false;
  async function run() {
    if (active) return;
    active = true;
    try { await oneCycle(); } finally { active = false; }
  }
  await run();
  setInterval(() => { void run(); }, HOUR);
} else {
  await oneCycle({ dryRun: preview });
  await pool.end();
}
