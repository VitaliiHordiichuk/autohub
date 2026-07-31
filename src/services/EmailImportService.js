import "dotenv/config";

import { createHash } from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { pool } from "../config/db.js";
import { ImportService } from "./ImportService.js";
import { ImportFileParserService } from "./ImportFileParserService.js";

import { EmailImportFileRepository } from "../repositories/EmailImportFileRepository.js";
import { EmailImportRuleRepository } from "../repositories/EmailImportRuleRepository.js";
import { EmailImportStateRepository } from "../repositories/EmailImportStateRepository.js";


const MAILBOX = "INBOX";
const MAX_NEW_MESSAGES_PER_RUN = 50;
const MANUAL_RESCAN_MESSAGES = 50;
const MAX_RETRY_FILES_PER_RUN = 20;
const MAX_RETRY_ATTEMPTS = 5;

const ADVISORY_LOCK_GROUP = "autohub";
const ADVISORY_LOCK_NAME = "email-import";


function readColumn(row, columnNumber) {
  if (columnNumber === null || columnNumber === undefined) {
    return null;
  }

  return row[columnNumber - 1] ?? null;
}


function parseRequiredNumber(value, fieldName, article, rowNumber) {
  const text = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");

  if (!text) {
    throw new Error(
      `Строка ${rowNumber}: отсутствует ${fieldName} для артикула ${article || "без артикула"}`
    );
  }

  const number = Number(text);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(
      `Строка ${rowNumber}: некорректное значение поля «${fieldName}» для артикула ${article || "без артикула"}`
    );
  }

  return number;
}


function normalizeImportedRow(row, settings, rowNumber) {
  const article = String(
    readColumn(row, settings.article_column) ?? ""
  ).trim();

  const name = String(
    readColumn(row, settings.name_column) ?? ""
  ).trim();

  let brand = null;

  if (settings.brand_mode === "FROM_FILE") {
    brand = String(
      readColumn(row, settings.brand_column) ?? ""
    ).trim();

    if (!brand) {
      throw new Error(
        `Строка ${rowNumber}: не указан бренд`
      );
    }
  }

  if (!article) {
    throw new Error(
      `Строка ${rowNumber}: отсутствует артикул`
    );
  }

  if (!name) {
    throw new Error(
      `Строка ${rowNumber}: для артикула ${article} отсутствует название`
    );
  }

  const quantity = parseRequiredNumber(
    readColumn(row, settings.quantity_column),
    "количество",
    article,
    rowNumber
  );

  const price = parseRequiredNumber(
    readColumn(row, settings.price_column),
    "цена",
    article,
    rowNumber
  );

  const retailPrice = settings.retail_price_column
    ? parseRequiredNumber(readColumn(row, settings.retail_price_column), "розничная цена", article, rowNumber)
    : null;

  if (settings.pricing_model === "OWN_DUAL_PRICE" && retailPrice === null) {
    throw new Error(`Строка ${rowNumber}: отсутствует розничная цена для артикула ${article}`);
  }

  return {
    rowNumber,
    brand: brand || null,
    article,
    name,
    quantity,
    price,
    retailPrice,
  };
}


function buildImportErrorRow(row, settings, error, rowNumber) {
  return {
    rowNumber,
    article: readColumn(row, settings.article_column),
    name: readColumn(row, settings.name_column),
    quantity: readColumn(row, settings.quantity_column),
    price: readColumn(row, settings.price_column),
    brand:
      settings.brand_mode === "FROM_FILE"
        ? readColumn(row, settings.brand_column)
        : null,
    error: error.message,
  };
}


function normalizeRows(parsedRows, settings) {
  const rows = [];
  const importErrors = [];
  const startRow = Number(settings.start_row) || 1;

  parsedRows.forEach((row, index) => {
    const rowNumber = index + startRow;

    try {
      rows.push(
        normalizeImportedRow(
          row,
          settings,
          rowNumber
        )
      );
    } catch (error) {
      importErrors.push(
        buildImportErrorRow(
          row,
          settings,
          error,
          rowNumber
        )
      );
    }
  });

  return {
    rows,
    importErrors,
  };
}


function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function textContains(value, expected) {
  const normalizedExpected = normalizeText(expected);

  if (!normalizedExpected) {
    return false;
  }

  return normalizeText(value).includes(normalizedExpected);
}


function calculateSha256(buffer) {
  return createHash("sha256")
    .update(buffer)
    .digest("hex");
}


function getEmailMessageId(mail, uid) {
  const messageId = String(mail.messageId || "").trim();

  if (messageId) {
    return messageId;
  }

  return `gmail-uid:${uid}`;
}


function getMailSenderAddresses(mail) {
  return mail.from?.value
    ?.map((item) => normalizeEmail(item.address))
    .filter(Boolean) || [];
}


function getEnvelopeSenderAddresses(envelope) {
  return envelope?.from
    ?.map((item) => normalizeEmail(item.address))
    .filter(Boolean) || [];
}


function ruleMatchesAttachment(rule, subject, fileName) {
  const subjectMatch = textContains(
    subject,
    rule.email_subject_contains
  );

  const fileNameMatch = textContains(
    fileName,
    rule.email_filename_contains
  );

  switch (rule.email_match_mode) {
    case "SENDER_ONLY":
      return true;

    case "SUBJECT":
      return subjectMatch;

    case "FILENAME":
      return fileNameMatch;

    case "SUBJECT_AND_FILENAME":
      return subjectMatch && fileNameMatch;

    case "SUBJECT_OR_FILENAME":
      return subjectMatch || fileNameMatch;

    default:
      return false;
  }
}


function findSenderRules(rules, senderAddresses) {
  const senderSet = new Set(
    senderAddresses.map(normalizeEmail)
  );

  return rules.filter((rule) =>
    senderSet.has(normalizeEmail(rule.email_from))
  );
}


async function acquireRunLock() {
  const db = await pool.connect();

  const result = await db.query(
    `
      SELECT pg_try_advisory_lock(
        hashtext($1),
        hashtext($2)
      ) AS locked
    `,
    [ADVISORY_LOCK_GROUP, ADVISORY_LOCK_NAME]
  );

  if (result.rows[0]?.locked !== true) {
    db.release();
    return null;
  }

  return db;
}


async function releaseRunLock(db) {
  if (!db) {
    return;
  }

  try {
    await db.query(
      `
        SELECT pg_advisory_unlock(
          hashtext($1),
          hashtext($2)
        )
      `,
      [ADVISORY_LOCK_GROUP, ADVISORY_LOCK_NAME]
    );
  } finally {
    db.release();
  }
}


function createImapClient() {
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailAppPassword) {
    throw new Error(
      "В .env отсутствуют GMAIL_USER или GMAIL_APP_PASSWORD"
    );
  }

  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
    logger: false,
  });
}


async function claimAttachment(
  settings,
  {
    uid,
    mail,
  },
  attachment
) {
  const fileName = attachment.filename || "";
  const content = attachment.content;

  if (!Buffer.isBuffer(content)) {
    throw new Error(
      `Не удалось прочитать вложение ${fileName}`
    );
  }

  const emailMessageId = getEmailMessageId(mail, uid);
  const attachmentSha256 = calculateSha256(content);
  const emailFrom = getMailSenderAddresses(mail)[0] || null;
  const emailSubject = mail.subject || null;
  const receivedAt = mail.date || null;

  const recordData = {
    warehouseSupplierImportId:
      Number(settings.warehouse_supplier_import_id),
    supplierImportSettingsId:
      Number(settings.supplier_import_settings_id),
    emailMessageId,
    emailUid: Number(uid),
    emailFrom,
    emailSubject,
    attachmentName: fileName,
    attachmentSha256,
    receivedAt,
  };

  const exact =
    await EmailImportFileRepository.findExact({
      warehouseSupplierImportId:
        recordData.warehouseSupplierImportId,
      emailMessageId,
      attachmentSha256,
    });

  if (
    exact?.status === "COMPLETED" &&
    exact.import_id &&
    (
      exact.import_status === "FAILED" ||
      Number(exact.import_success_rows || 0) === 0
    )
  ) {
    await EmailImportFileRepository.markFailed({
      id: exact.id,
      errorMessage: "Предыдущий импорт файла не создал ни одной позиции",
    });
    exact.status = "FAILED";
  }

  if (exact?.status === "COMPLETED") {
    return {
      action: "SKIP_COMPLETED",
      record: exact,
    };
  }

  if (exact?.status === "PROCESSING") {
    return {
      action: "SKIP_PROCESSING",
      record: exact,
    };
  }

  if (exact?.status === "FAILED") {
    const completedSameFile =
      await EmailImportFileRepository.findCompletedByHash({
        warehouseSupplierImportId:
          recordData.warehouseSupplierImportId,
        attachmentSha256,
      });

    if (completedSameFile) {
      const duplicateRecord =
        await EmailImportFileRepository.createCompletedReference({
          ...recordData,
          importId: completedSameFile.import_id,
        });

      return {
        action: "SKIP_SAME_FILE",
        record: duplicateRecord,
      };
    }

    const retried =
      await EmailImportFileRepository.retryFailed(
        exact.id
      );

    if (retried) {
      return {
        action: "PROCESS",
        record: retried,
      };
    }
  }

  const sameHash =
    await EmailImportFileRepository.findCompletedByHash({
      warehouseSupplierImportId:
        recordData.warehouseSupplierImportId,
      attachmentSha256,
    });

  if (sameHash) {
    const duplicateRecord =
      await EmailImportFileRepository.createCompletedReference({
        ...recordData,
        importId: sameHash.import_id,
      });

    return {
      action: "SKIP_SAME_FILE",
      record: duplicateRecord,
    };
  }

  const processingRecord =
    await EmailImportFileRepository.createProcessing(
      recordData
    );

  if (processingRecord) {
    return {
      action: "PROCESS",
      record: processingRecord,
    };
  }

  const concurrentRecord =
    await EmailImportFileRepository.findExact({
      warehouseSupplierImportId:
        recordData.warehouseSupplierImportId,
      emailMessageId,
      attachmentSha256,
    });

  return {
    action: "SKIP_CONCURRENT",
    record: concurrentRecord,
  };
}


async function importAttachment(settings, attachment) {
  const fileName = attachment.filename || "";
  const fileType =
    ImportFileParserService.detectFileType(fileName);

  if (!fileType) {
    throw new Error(
      `Формат файла ${fileName} не поддерживается`
    );
  }

  if (!Buffer.isBuffer(attachment.content)) {
    throw new Error(
      `Не удалось прочитать вложение ${fileName}`
    );
  }

  const parsedRows =
    await ImportFileParserService.parseFileBuffer({
      buffer: attachment.content,
      fileType,
      startRow: settings.start_row,
    });

  if (parsedRows.length === 0) {
    throw new Error(
      `Файл ${fileName} не содержит данных`
    );
  }

  const {
    rows,
    importErrors,
  } = normalizeRows(
    parsedRows,
    settings
  );

  const result = await ImportService.importRows(
    {
      warehouseId: Number(settings.warehouse_id),
      warehouseSupplierImportId:
        Number(settings.warehouse_supplier_import_id),
      fileName,
      fileType,
      importMethod: "EMAIL",
    },
    rows,
    importErrors
  );

  return {
    fileName,
    fileType,
    result,
  };
}


function recordSkippedClaim(summary, action) {
  if (
    action === "SKIP_COMPLETED" ||
    action === "SKIP_SAME_FILE"
  ) {
    summary.duplicateFiles++;
    return;
  }

  if (
    action === "SKIP_PROCESSING" ||
    action === "SKIP_CONCURRENT"
  ) {
    summary.concurrentFiles++;
  }
}


async function processRoutedAttachment(
  settings,
  found,
  attachment,
  summary
) {
  let claim = null;

  try {
    claim = await claimAttachment(
      settings,
      found,
      attachment
    );

    if (claim.action !== "PROCESS") {
      recordSkippedClaim(summary, claim.action);

      summary.files.push({
        uid: found.uid,
        fileName: attachment.filename || null,
        warehouseSupplierImportId:
          Number(settings.warehouse_supplier_import_id),
        action: claim.action,
        importId: claim.record?.import_id || null,
      });

      return;
    }

    const imported = await importAttachment(
      settings,
      attachment
    );

    if (
      Number(imported.result.successRows || 0) === 0 &&
      Number(imported.result.errors || 0) > 0
    ) {
      throw new Error(
        `Импорт не выполнен: ошибок строк ${imported.result.errors}, успешных строк 0`
      );
    }

    await EmailImportFileRepository.markCompleted({
      id: claim.record.id,
      importId: imported.result.importId,
    });

    summary.importedFiles++;
    summary.importedRows +=
      Number(imported.result.successRows || 0);
    summary.rowErrors +=
      Number(imported.result.errors || 0);

    summary.files.push({
      uid: found.uid,
      fileName: imported.fileName,
      fileType: imported.fileType,
      warehouseSupplierImportId:
        Number(settings.warehouse_supplier_import_id),
      action: "IMPORTED",
      importId: imported.result.importId,
      totalRows: imported.result.total,
      successRows: imported.result.successRows,
      errorRows: imported.result.errors,
    });

  } catch (error) {
    if (claim?.record?.id) {
      await EmailImportFileRepository.markFailed({
        id: claim.record.id,
        errorMessage: error.message,
      }).catch(() => {});
    }

    summary.failedFiles++;
    summary.errors.push({
      uid: found.uid,
      fileName: attachment.filename || null,
      warehouseSupplierImportId:
        Number(settings.warehouse_supplier_import_id),
      error: error.message,
    });
  }
}


async function retryFailedFiles(client, summary) {
  const failedRecords =
    await EmailImportFileRepository.findRetryableFailed({
      limit: MAX_RETRY_FILES_PER_RUN,
      maxAttempts: MAX_RETRY_ATTEMPTS,
    });

  for (const record of failedRecords) {
    let processingRecord = null;

    try {
      processingRecord =
        await EmailImportFileRepository.retryFailed(
          record.id
        );

      if (!processingRecord) {
        continue;
      }

      const message = await client.fetchOne(
        Number(record.email_uid),
        {
          uid: true,
          source: true,
        },
        {
          uid: true,
        }
      );

      if (!message?.source) {
        throw new Error(
          `Письмо UID ${record.email_uid} больше не найдено`
        );
      }

      const mail = await simpleParser(message.source);
      const attachments = mail.attachments || [];

      const attachment = attachments.find((item) => {
        if (!Buffer.isBuffer(item.content)) {
          return false;
        }

        return calculateSha256(item.content) ===
          record.attachment_sha256;
      });

      if (!attachment) {
        throw new Error(
          `В письме UID ${record.email_uid} не найдено прежнее вложение ${record.attachment_name}`
        );
      }

      const imported = await importAttachment(
        record,
        attachment
      );

      if (
        Number(imported.result.successRows || 0) === 0 &&
        Number(imported.result.errors || 0) > 0
      ) {
        throw new Error(
          `Импорт не выполнен: ошибок строк ${imported.result.errors}, успешных строк 0`
        );
      }

      await EmailImportFileRepository.markCompleted({
        id: record.id,
        importId: imported.result.importId,
      });

      summary.retriedFiles++;
      summary.importedFiles++;
      summary.importedRows +=
        Number(imported.result.successRows || 0);
      summary.rowErrors +=
        Number(imported.result.errors || 0);

      summary.files.push({
        uid: Number(record.email_uid),
        fileName: imported.fileName,
        fileType: imported.fileType,
        warehouseSupplierImportId:
          Number(record.warehouse_supplier_import_id),
        action: "RETRIED_AND_IMPORTED",
        importId: imported.result.importId,
      });

    } catch (error) {
      if (processingRecord?.id) {
        await EmailImportFileRepository.markFailed({
          id: processingRecord.id,
          errorMessage: error.message,
        }).catch(() => {});
      }

      summary.retryErrors++;
      summary.errors.push({
        uid: Number(record.email_uid),
        fileName: record.attachment_name,
        warehouseSupplierImportId:
          Number(record.warehouse_supplier_import_id),
        error: `Повторная обработка: ${error.message}`,
      });
    }
  }
}


async function getMessagesToCheck(
  client,
  {
    lastUid,
    rescanRecent,
  }
) {
  const byUid = new Map();
  const uidNext = Number(client.mailbox?.uidNext || 1);
  const highestUid = Math.max(0, uidNext - 1);
  const firstNewUid = Number(lastUid) + 1;

  let newUids = [];

  if (firstNewUid <= highestUid) {
    newUids = await client.search(
      {
        uid: `${firstNewUid}:${highestUid}`,
      },
      {
        uid: true,
      }
    );

    newUids = newUids
      .map(Number)
      .filter((uid) => uid >= firstNewUid)
      .sort((a, b) => a - b)
      .slice(0, MAX_NEW_MESSAGES_PER_RUN);

    if (newUids.length > 0) {
      const messages = await client.fetchAll(
        newUids,
        {
          uid: true,
          envelope: true,
        },
        {
          uid: true,
        }
      );

      for (const message of messages) {
        byUid.set(Number(message.uid), message);
      }
    }
  }

  if (rescanRecent && Number(client.mailbox?.exists || 0) > 0) {
    const exists = Number(client.mailbox.exists);
    const firstSequence = Math.max(
      1,
      exists - MANUAL_RESCAN_MESSAGES + 1
    );

    const recentMessages = await client.fetchAll(
      `${firstSequence}:*`,
      {
        uid: true,
        envelope: true,
      }
    );

    for (const message of recentMessages) {
      byUid.set(Number(message.uid), message);
    }
  }

  return {
    messages: [...byUid.values()]
      .sort((a, b) => Number(a.uid) - Number(b.uid)),
    newUids,
    highestUid,
  };
}


function createSummary(source, rescanRecent) {
  return {
    status: "COMPLETED",
    source,
    rescanRecent,
    checkedMessages: 0,
    newMessages: 0,
    senderMatchedMessages: 0,
    messagesWithoutPriceFiles: 0,
    importedFiles: 0,
    importedRows: 0,
    rowErrors: 0,
    duplicateFiles: 0,
    concurrentFiles: 0,
    unmatchedFiles: 0,
    ambiguousFiles: 0,
    failedFiles: 0,
    retriedFiles: 0,
    retryErrors: 0,
    files: [],
    unmatched: [],
    ambiguous: [],
    errors: [],
  };
}


export const EmailImportService = {

  async processMailbox(
    {
      source = "MANUAL",
      rescanRecent = source === "MANUAL",
    } = {}
  ) {
    const normalizedSource = String(source)
      .trim()
      .toUpperCase();

    if (!["STARTUP", "SCHEDULER", "MANUAL"].includes(normalizedSource)) {
      throw new Error(
        "Некорректный источник запуска EMAIL-импорта"
      );
    }

    const accountKey = normalizeEmail(
      process.env.GMAIL_USER
    );

    if (!accountKey) {
      throw new Error(
        "В .env отсутствует GMAIL_USER"
      );
    }

    const runLockDb = await acquireRunLock();

    if (!runLockDb) {
      return {
        status: "SKIPPED_ALREADY_RUNNING",
        source: normalizedSource,
        message: "Обработка почты уже выполняется",
      };
    }

    const state =
      await EmailImportStateRepository.getOrCreate({
        accountKey,
        mailbox: MAILBOX,
      });

    await EmailImportStateRepository.markStarted({
      id: state.id,
      source: normalizedSource,
    });

    const summary = createSummary(
      normalizedSource,
      Boolean(rescanRecent)
    );

    const client = createImapClient();
    let connected = false;
    let mailboxLock = null;
    let lastProcessedUid = Number(state.last_uid || 0);

    try {
      const rules =
        await EmailImportRuleRepository.findActive();

      if (rules.length === 0) {
        throw new Error(
          "В базе нет активных правил автоматического EMAIL-импорта"
        );
      }

      await client.connect();
      connected = true;

      mailboxLock = await client.getMailboxLock(
        MAILBOX,
        {
          readOnly: true,
        }
      );

      const currentUidValidity = String(
        client.mailbox?.uidValidity || ""
      );

      if (!currentUidValidity) {
        throw new Error(
          "Gmail не вернул UIDVALIDITY для папки INBOX"
        );
      }

      if (!state.uid_validity) {
        await EmailImportStateRepository.setUidValidity({
          id: state.id,
          uidValidity: currentUidValidity,
        });
      } else if (
        String(state.uid_validity) !== currentUidValidity
      ) {
        throw new Error(
          "UIDVALIDITY почтового ящика изменился. Автоматическая обработка остановлена, чтобы не повторить старые письма"
        );
      }

      await retryFailedFiles(
        client,
        summary
      );

      const {
        messages,
        newUids,
      } = await getMessagesToCheck(
        client,
        {
          lastUid: Number(state.last_uid || 0),
          rescanRecent: Boolean(rescanRecent),
        }
      );

      const newUidSet = new Set(newUids);
      summary.newMessages = newUids.length;

      for (const message of messages) {
        const uid = Number(message.uid);
        summary.checkedMessages++;

        try {
          const envelopeSenders =
            getEnvelopeSenderAddresses(
              message.envelope
            );

          const senderRules = findSenderRules(
            rules,
            envelopeSenders
          );

          if (senderRules.length === 0) {
            continue;
          }

          summary.senderMatchedMessages++;

          const fullMessage = await client.fetchOne(
            uid,
            {
              uid: true,
              source: true,
            },
            {
              uid: true,
            }
          );

          if (!fullMessage?.source) {
            throw new Error(
              `Не удалось получить письмо UID ${uid}`
            );
          }

          const mail = await simpleParser(
            fullMessage.source
          );

          const actualSenderRules = findSenderRules(
            rules,
            getMailSenderAddresses(mail)
          );

          const attachments = mail.attachments || [];
          const priceAttachments = attachments.filter(
            (attachment) =>
              Boolean(
                ImportFileParserService.detectFileType(
                  attachment.filename
                )
              )
          );

          if (priceAttachments.length === 0) {
            summary.messagesWithoutPriceFiles++;
            continue;
          }

          for (const attachment of priceAttachments) {
            const matchedRules = actualSenderRules.filter(
              (rule) => ruleMatchesAttachment(
                rule,
                mail.subject,
                attachment.filename
              )
            );

            if (matchedRules.length === 0) {
              summary.unmatchedFiles++;
              summary.unmatched.push({
                uid,
                sender:
                  getMailSenderAddresses(mail)[0] || null,
                subject: mail.subject || null,
                fileName: attachment.filename || null,
                error:
                  "Для файла не найдено правило импорта",
              });
              continue;
            }

            if (matchedRules.length > 1) {
              summary.ambiguousFiles++;
              summary.ambiguous.push({
                uid,
                sender:
                  getMailSenderAddresses(mail)[0] || null,
                subject: mail.subject || null,
                fileName: attachment.filename || null,
                warehouseSupplierImportIds:
                  matchedRules.map((rule) =>
                    Number(rule.warehouse_supplier_import_id)
                  ),
                error:
                  "Файл подходит нескольким складам",
              });
              continue;
            }

            await processRoutedAttachment(
              matchedRules[0],
              {
                uid,
                mail,
              },
              attachment,
              summary
            );
          }

        } catch (error) {
          summary.errors.push({
            uid,
            error: error.message,
          });
        } finally {
          if (newUidSet.has(uid)) {
            lastProcessedUid = Math.max(
              lastProcessedUid,
              uid
            );

            await EmailImportStateRepository.markProgress({
              id: state.id,
              lastUid: lastProcessedUid,
            });
          }
        }
      }

      await EmailImportStateRepository.markSucceeded({
        id: state.id,
        lastUid: lastProcessedUid,
        result: summary,
      });

      return summary;

    } catch (error) {
      summary.status = "FAILED";
      summary.errors.push({
        error: error.message,
      });

      await EmailImportStateRepository.markFailed({
        id: state.id,
        errorMessage: error.message,
        result: summary,
      }).catch(() => {});

      throw error;

    } finally {
      if (mailboxLock) {
        mailboxLock.release();
      }

      if (connected) {
        await client.logout().catch(() => {});
      }

      await releaseRunLock(runLockDb);
    }
  },


  async getStatus() {
    const accountKey = normalizeEmail(
      process.env.GMAIL_USER
    );

    if (!accountKey) {
      throw new Error(
        "В .env отсутствует GMAIL_USER"
      );
    }

    return EmailImportStateRepository.findByAccount({
      accountKey,
      mailbox: MAILBOX,
    });
  },

};
