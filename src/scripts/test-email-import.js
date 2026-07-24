import "dotenv/config";
import { createHash } from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { pool } from "../config/db.js";
import { ImportService } from "../services/ImportService.js";
import { ImportFileParserService } from "../services/ImportFileParserService.js";
import { EmailImportFileRepository } from "../repositories/EmailImportFileRepository.js";


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

  return {
    brand: brand || null,
    article,
    name,
    quantity,
    price,
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


function normalizeSubject(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
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


function getSenderAddress(mail) {
  return normalizeEmail(
    mail.from?.value?.[0]?.address
  ) || null;
}


async function loadEmailImportSettings() {
  const result = await pool.query(`
    SELECT
      wsi.id AS warehouse_supplier_import_id,
      wsi.warehouse_id,
      wsi.supplier_id,
      sis.id AS supplier_import_settings_id,
      sis.import_method,
      sis.brand_mode,
      sis.fixed_brand_id,
      sis.brand_column,
      sis.article_column,
      sis.name_column,
      sis.price_column,
      sis.quantity_column,
      sis.start_row,
      sis.email_from,
      sis.email_subject,
      s.name AS supplier_name
    FROM warehouse_supplier_imports wsi
    JOIN supplier_import_settings sis
      ON sis.id = wsi.supplier_import_settings_id
    JOIN suppliers s
      ON s.id = wsi.supplier_id
    WHERE wsi.is_active = TRUE
      AND sis.is_active = TRUE
      AND sis.import_method = 'EMAIL'
      AND sis.email_from IS NOT NULL
      AND sis.email_subject IS NOT NULL
    ORDER BY wsi.id
  `);

  return result.rows;
}


async function findLatestMatchingMessage(client, settings) {
  const uids = await client.search(
    {
      from: settings.email_from,
      subject: settings.email_subject,
    },
    {
      uid: true,
    }
  );

  if (!uids || uids.length === 0) {
    return null;
  }

  const sortedUids = [...uids].sort((a, b) => b - a);

  for (const uid of sortedUids) {
    const message = await client.fetchOne(
      uid,
      {
        uid: true,
        envelope: true,
        source: true,
      },
      {
        uid: true,
      }
    );

    if (!message?.source) {
      continue;
    }

    const mail = await simpleParser(message.source);
    const senderAddresses =
      mail.from?.value
        ?.map((item) => normalizeEmail(item.address))
        .filter(Boolean) || [];

    const expectedSender = normalizeEmail(settings.email_from);
    const subject = normalizeSubject(mail.subject);
    const expectedSubject = normalizeSubject(settings.email_subject);

    if (!senderAddresses.includes(expectedSender)) {
      continue;
    }

    if (!subject.includes(expectedSubject)) {
      continue;
    }

    return {
      uid,
      mail,
    };
  }

  return null;
}


async function claimAttachment(
  settings,
  found,
  attachment
) {
  const fileName = attachment.filename || "";
  const content = attachment.content;

  if (!Buffer.isBuffer(content)) {
    throw new Error(
      `Не удалось прочитать вложение ${fileName}`
    );
  }

  const emailMessageId = getEmailMessageId(
    found.mail,
    found.uid
  );

  const attachmentSha256 = calculateSha256(content);
  const emailFrom = getSenderAddress(found.mail);
  const emailSubject = found.mail.subject || null;
  const receivedAt = found.mail.date || null;

  const recordData = {
    warehouseSupplierImportId:
      Number(settings.warehouse_supplier_import_id),
    supplierImportSettingsId:
      Number(settings.supplier_import_settings_id),
    emailMessageId,
    emailUid: Number(found.uid),
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

  const previousImport =
    await EmailImportFileRepository.findRecentUntrackedImport({
      warehouseSupplierImportId:
        recordData.warehouseSupplierImportId,
      fileName,
      receivedAt,
    });

  if (previousImport) {
    const registeredRecord =
      await EmailImportFileRepository.createCompletedReference({
        ...recordData,
        importId: previousImport.id,
      });

    return {
      action: "REGISTERED_PREVIOUS_IMPORT",
      record: registeredRecord,
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
    return null;
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


const gmailUser = process.env.GMAIL_USER;
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

if (!gmailUser || !gmailAppPassword) {
  throw new Error(
    "В .env отсутствуют GMAIL_USER или GMAIL_APP_PASSWORD"
  );
}

const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: {
    user: gmailUser,
    pass: gmailAppPassword,
  },
  logger: false,
});

let connected = false;

try {
  const settingsList =
    await loadEmailImportSettings();

  if (settingsList.length === 0) {
    throw new Error(
      "В базе нет активных настроек EMAIL-импорта"
    );
  }

  console.log(
    `Активных настроек EMAIL-импорта: ${settingsList.length}`
  );

  await client.connect();
  connected = true;

  const lock = await client.getMailboxLock(
    "INBOX",
    {
      readOnly: true,
    }
  );

  try {
    for (const settings of settingsList) {
      console.log("");
      console.log(
        `Поставщик: ${settings.supplier_name}`
      );
      console.log(
        `Ищем: ${settings.email_from} / ${settings.email_subject}`
      );

      const found =
        await findLatestMatchingMessage(
          client,
          settings
        );

      if (!found) {
        console.log("Письмо не найдено");
        continue;
      }

      const attachments =
        found.mail.attachments || [];

      const priceAttachments =
        attachments.filter((attachment) =>
          Boolean(
            ImportFileParserService.detectFileType(
              attachment.filename
            )
          )
        );

      if (priceAttachments.length === 0) {
        console.log(
          "В письме нет вложений CSV/XLSX"
        );
        continue;
      }

      console.log(
        `Письмо найдено, UID: ${found.uid}`
      );
      console.log(
        `Файлов прайса: ${priceAttachments.length}`
      );

      for (const attachment of priceAttachments) {
        let claim = null;

        try {
          claim = await claimAttachment(
            settings,
            found,
            attachment
          );

          if (claim.action === "SKIP_COMPLETED") {
            console.log(
              `⏭ ${attachment.filename}: уже обработан, импорт №${claim.record.import_id}`
            );
            continue;
          }

          if (claim.action === "SKIP_PROCESSING") {
            console.log(
              `⏳ ${attachment.filename}: уже обрабатывается другим запуском`
            );
            continue;
          }

          if (claim.action === "SKIP_SAME_FILE") {
            console.log(
              `⏭ ${attachment.filename}: такой файл уже импортировался, импорт №${claim.record.import_id}`
            );
            continue;
          }

          if (claim.action === "REGISTERED_PREVIOUS_IMPORT") {
            console.log(
              `🧾 ${attachment.filename}: привязан ранее выполненный импорт №${claim.record.import_id}`
            );
            continue;
          }

          if (claim.action === "SKIP_CONCURRENT") {
            console.log(
              `⏭ ${attachment.filename}: файл уже забрал другой запуск`
            );
            continue;
          }

          const imported =
            await importAttachment(
              settings,
              attachment
            );

          if (!imported) {
            continue;
          }

          await EmailImportFileRepository.markCompleted({
            id: claim.record.id,
            importId: imported.result.importId,
          });

          console.log(
            `✅ ${imported.fileName}: импорт №${imported.result.importId}`
          );
          console.log(
            `   Всего: ${imported.result.total}, успешно: ${imported.result.successRows}, ошибок: ${imported.result.errors}`
          );

        } catch (error) {
          if (claim?.record?.id) {
            await EmailImportFileRepository.markFailed({
              id: claim.record.id,
              errorMessage: error.message,
            }).catch(() => {});
          }

          console.error(
            `❌ ${attachment.filename || "вложение"}: ${error.message}`
          );
        }
      }
    }
  } finally {
    lock.release();
  }
} catch (error) {
  console.error("");
  console.error(
    `❌ Ошибка EMAIL-импорта: ${error.message}`
  );
  process.exitCode = 1;
} finally {
  if (connected) {
    await client.logout().catch(() => {});
  }

  await pool.end().catch(() => {});
}
