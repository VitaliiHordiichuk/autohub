import { EmailImportService } from "../services/EmailImportService.js";


export async function processEmailNow(req, res) {
  try {
    const result = await EmailImportService.processMailbox({
      source: "MANUAL",
      rescanRecent: true,
    });

    console.log(
      `EMAIL-импорт MANUAL: проверено писем ${result.checkedMessages}, новых ${result.newMessages}, импортировано файлов ${result.importedFiles}, строк ${result.importedRows}, ошибок строк ${result.rowErrors}, дубликатов ${result.duplicateFiles}`
    );

    return res.json({
      success: true,
      message:
        result.status === "SKIPPED_ALREADY_RUNNING"
          ? "Обработка почты уже выполняется"
          : "Почта обработана",
      result,
    });

  } catch (error) {
    console.error(
      "Ошибка ручной обработки почты:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}


export async function getEmailImportStatus(req, res) {
  try {
    const status = await EmailImportService.getStatus();

    return res.json({
      success: true,
      status,
    });

  } catch (error) {
    console.error(
      "Ошибка получения статуса EMAIL-импорта:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
