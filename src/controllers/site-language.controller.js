import {
  SiteLanguageService,
} from "../services/SiteLanguageService.js";

function sendError(
  res,
  error
) {
  return res.status(400).json({
    success: false,
    error:
      error instanceof Error
        ? error.message
        : "Помилка запиту",
  });
}

export async function getPublicLanguages(
  req,
  res
) {
  try {
    const result =
      await SiteLanguageService
        .getPublicLanguages();

    return res.json({
      success: true,
      ...result,
    });

  } catch (error) {
    console.error(
      "Language public list error:",
      error
    );

    return sendError(res, error);
  }
}

export async function getAdminLanguages(
  req,
  res
) {
  try {
    const result =
      await SiteLanguageService
        .getAdminLanguages();

    return res.json({
      success: true,
      ...result,
    });

  } catch (error) {
    console.error(
      "Language admin list error:",
      error
    );

    return sendError(res, error);
  }
}

export async function updateAdminLanguage(
  req,
  res
) {
  try {
    const language =
      await SiteLanguageService
        .updateLanguage(
          req.params.code,
          req.body
        );

    return res.json({
      success: true,
      language,
    });

  } catch (error) {
    console.error(
      "Language update error:",
      error
    );

    return sendError(res, error);
  }
}
