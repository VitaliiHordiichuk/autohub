import {
  ProductTranslationService,
} from "../services/ProductTranslationService.js";


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


export async function listProductTranslations(
  req,
  res
) {
  try {
    const result =
      await ProductTranslationService
        .list(
          req.params.productId
        );

    return res.json({
      success: true,
      ...result,
    });

  } catch (error) {
    return sendError(
      res,
      error,
      "Помилка отримання перекладів товару"
    );
  }
}


export async function saveProductTranslation(
  req,
  res
) {
  try {
    const translation =
      await ProductTranslationService
        .save({
          productId:
            req.params.productId,

          languageCode:
            req.params.languageCode,

          name:
            req.body.name,

          description:
            req.body.description,
        });

    return res.json({
      success: true,
      translation,
    });

  } catch (error) {
    return sendError(
      res,
      error,
      "Помилка збереження перекладу товару"
    );
  }
}
