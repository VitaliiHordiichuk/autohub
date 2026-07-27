import { ImportReviewService }
from "../services/ImportReviewService.js";

export async function getPendingNewProducts(
  req,
  res
) {
  try {
    const result =
      await ImportReviewService
        .getPending({
          warehouseId:
            req.query.warehouseId ?? null,
          page:
            req.query.page ?? 1,
          pageSize:
            req.query.pageSize ??
            req.query.limit ??
            50,
        });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error(
      "Ошибка получения новых товаров:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function approveNewProduct(
  req,
  res
) {
  try {
    const item =
      await ImportReviewService
        .approve(
          req.params.reviewId
        );

    return res.json({
      success: true,
      message:
        "Новый товар согласован",
      item,
    });
  } catch (error) {
    console.error(
      "Ошибка согласования нового товара:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function approveAllNewProducts(
  req,
  res
) {
  try {
    const result =
      await ImportReviewService
        .approveAll(
          req.body.warehouseId
        );

    return res.json({
      success: true,
      message:
        "Новые товары согласованы",
      ...result,
    });
  } catch (error) {
    console.error(
      "Ошибка массового согласования новых товаров:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function rejectNewProduct(
  req,
  res
) {
  try {
    const item =
      await ImportReviewService
        .reject(
          req.params.reviewId
        );

    return res.json({
      success: true,
      message:
        "Новый товар отклонён",
      item,
    });
  } catch (error) {
    console.error(
      "Ошибка отклонения нового товара:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function getImportReport(
  req,
  res
) {
  try {
    const report =
      await ImportReviewService
        .getReport(
          req.params.importId,
          req.query.warehouseId
        );

    return res.json({
      success: true,
      report,
    });
  } catch (error) {
    console.error(
      "Ошибка получения отчёта импорта:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}
