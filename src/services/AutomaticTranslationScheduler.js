import {
  AutomaticTranslationService,
} from "./AutomaticTranslationService.js";


const STARTUP_DELAY_MS =
  8 * 1000;

let startupTimer = null;
let intervalTimer = null;


function getIntervalMs() {
  const minutes =
    Number(
      process.env
        .AUTO_TRANSLATION_INTERVAL_MINUTES
    );

  const safeMinutes =
    Number.isFinite(minutes) &&
    minutes >= 1
      ? minutes
      : 5;

  return safeMinutes *
    60 *
    1000;
}


async function runSafely(source) {
  try {
    const result =
      await AutomaticTranslationService
        .processQueue({
          source,
        });

    if (
      result.status ===
      "DISABLED"
    ) {
      return;
    }

    if (
      result.status ===
      "SKIPPED_ALREADY_RUNNING"
    ) {
      console.log(
        "Переклади: попередня обробка ще виконується"
      );
      return;
    }

    if (
      result.claimed > 0
    ) {
      console.log(
        [
          `Переклади ${source}:`,
          `отримано ${result.claimed},`,
          `DeepL ${result.translated},`,
          `пам'ять ${result.memoryHits},`,
          `помилок ${result.failed}`,
        ].join(" ")
      );
    }

  } catch (error) {
    console.error(
      `Помилка автоматичних перекладів (${source}):`,
      error.message
    );
  }
}


export function startAutomaticTranslationScheduler() {
  if (
    startupTimer ||
    intervalTimer
  ) {
    return;
  }

  if (
    !AutomaticTranslationService
      .isEnabled()
  ) {
    console.log(
      "Переклади: автоматичний переклад вимкнено"
    );
    return;
  }

  startupTimer =
    setTimeout(() => {
      startupTimer = null;

      void runSafely(
        "STARTUP"
      );
    }, STARTUP_DELAY_MS);

  startupTimer.unref?.();

  intervalTimer =
    setInterval(() => {
      void runSafely(
        "SCHEDULER"
      );
    }, getIntervalMs());

  intervalTimer.unref?.();

  console.log(
    "Переклади: DeepL увімкнено, перевірка кожні 5 хвилин"
  );
}


export function stopAutomaticTranslationScheduler() {
  if (startupTimer) {
    clearTimeout(
      startupTimer
    );

    startupTimer = null;
  }

  if (intervalTimer) {
    clearInterval(
      intervalTimer
    );

    intervalTimer = null;
  }
}
