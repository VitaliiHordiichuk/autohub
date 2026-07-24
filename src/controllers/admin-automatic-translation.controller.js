import {
  AutomaticTranslationService,
} from "../services/AutomaticTranslationService.js";


function sendError(
  res,
  error,
  action
) {
  console.error(
    `${action}:`,
    error
  );

  return res
    .status(
      error.statusCode || 400
    )
    .json({
      success: false,

      error:
        error.message ||
        "Помилка запиту",
    });
}


export async function getAutomaticTranslationStatus(
  req,
  res
) {
  try {
    const status =
      await AutomaticTranslationService
        .getStatus();

    return res.json({
      success: true,
      status,
    });

  } catch (error) {
    return sendError(
      res,
      error,
      "Помилка статусу перекладів"
    );
  }
}


export async function processAutomaticTranslations(
  req,
  res
) {
  try {
    const result =
      await AutomaticTranslationService
        .processQueue({
          source:
            "ADMIN_API",
        });

    return res.json({
      success: true,
      result,
    });

  } catch (error) {
    return sendError(
      res,
      error,
      "Помилка запуску перекладів"
    );
  }
}


export async function retryFailedAutomaticTranslations(
  req,
  res
) {
  try {
    const result =
      await AutomaticTranslationService
        .retryFailed();

    return res.json({
      success: true,
      result,
    });

  } catch (error) {
    return sendError(
      res,
      error,
      "Помилка повторного запуску перекладів"
    );
  }
}
