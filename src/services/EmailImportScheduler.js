import { EmailImportService } from "./EmailImportService.js";


const ONE_HOUR_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 5 * 1000;

let intervalTimer = null;
let startupTimer = null;


async function runSafely(source) {
  try {
    const result = await EmailImportService.processMailbox({
      source,
      rescanRecent: false,
    });

    if (result.status === "SKIPPED_ALREADY_RUNNING") {
      console.log(
        "EMAIL-импорт: предыдущая обработка ещё выполняется"
      );
      return;
    }

    console.log(
      `EMAIL-импорт ${source}: писем ${result.newMessages}, файлов импортировано ${result.importedFiles}, ошибок файлов ${result.failedFiles}`
    );

  } catch (error) {
    console.error(
      `Ошибка автоматического EMAIL-импорта (${source}):`,
      error.message
    );
  }
}


export function startEmailImportScheduler() {
  const enabled = !["false", "0", "no", "off"].includes(
    String(process.env.EMAIL_IMPORT_SCHEDULER_ENABLED ?? "true").trim().toLowerCase()
  );
  if (!enabled) {
    console.log("ℹ️ EMAIL-импорт: автоматическая проверка отключена настройкой");
    return;
  }
  if (intervalTimer || startupTimer) {
    return;
  }

  startupTimer = setTimeout(() => {
    startupTimer = null;
    void runSafely("STARTUP");
  }, STARTUP_DELAY_MS);

  startupTimer.unref?.();

  intervalTimer = setInterval(() => {
    void runSafely("SCHEDULER");
  }, ONE_HOUR_MS);

  intervalTimer.unref?.();

  console.log(
    "EMAIL-импорт: автоматическая проверка включена раз в час"
  );
}


export function stopEmailImportScheduler() {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }

  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
