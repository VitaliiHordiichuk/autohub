import {
  AdminWarehouseOfferService,
} from "../services/AdminWarehouseOfferService.js";


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
      error: error.message,
    });
}


export async function listWarehouseOffers(
  req,
  res
) {
  try {
    const result =
      await AdminWarehouseOfferService
        .listOffers({
          warehouseId:
            req.params.warehouseId,

          search:
            req.query.search,

          status:
            req.query.status,

          locale:
            req.query.locale,

          page:
            req.query.page,

          limit:
            req.query.limit,
        });

    return res.json({
      success: true,
      ...result,
    });

  } catch(error) {
    return sendError(
      res,
      error,
      "Ошибка получения позиций склада"
    );
  }
}


export async function addManualWarehousePosition(
  req,
  res
) {
  try {
    const result =
      await AdminWarehouseOfferService
        .addManualPosition({
          warehouseId:
            req.params.warehouseId,

          brandId:
            req.body.brandId,

          article:
            req.body.article,

          name:
            req.body.name,

          quantity:
            req.body.quantity,

          purchasePrice:
            req.body.purchasePrice,
        });

    return res.status(201).json({
      success: true,
      message:
        result.created
          ? "Позиция добавлена на склад"
          : "Позиция склада обновлена",
      ...result,
    });

  } catch(error) {
    return sendError(
      res,
      error,
      "Ошибка ручного добавления позиции"
    );
  }
}


export async function removeOfferUntilNextImport(
  req,
  res
) {
  try {
    const result =
      await AdminWarehouseOfferService
        .removeUntilNextImport({
          warehouseId:
            req.params.warehouseId,

          offerId:
            req.params.offerId,
        });

    return res.json({
      success: true,
      message:
        "Позиция убрана со склада до следующего импорта",
      ...result,
    });

  } catch(error) {
    return sendError(
      res,
      error,
      "Ошибка удаления позиции со склада"
    );
  }
}


export async function setManualOfferPrice(
  req,
  res
) {
  try {
    const result =
      await AdminWarehouseOfferService
        .setManualPrice({
          warehouseId:
            req.params.warehouseId,

          offerId:
            req.params.offerId,

          price:
            req.body.price,

          changedBy:
            req.user?.id ??
            req.body.changedBy ??
            null,
        });

    return res.json({
      success: true,
      message:
        "Ручная цена сохранена",
      ...result,
    });

  } catch(error) {
    return sendError(
      res,
      error,
      "Ошибка изменения цены"
    );
  }
}


export async function resetAutomaticOfferPrice(
  req,
  res
) {
  try {
    const result =
      await AdminWarehouseOfferService
        .resetAutomaticPrice({
          warehouseId:
            req.params.warehouseId,

          offerId:
            req.params.offerId,

          changedBy:
            req.user?.id ??
            req.body?.changedBy ??
            null,
        });

    return res.json({
      success: true,
      message:
        "Автоматическая цена восстановлена",
      ...result,
    });

  } catch(error) {
    return sendError(
      res,
      error,
      "Ошибка возврата автоматической цены"
    );
  }
}


export async function setOfferVisibility(
  req,
  res
) {
  try {
    const result =
      await AdminWarehouseOfferService
        .setVisibility({
          warehouseId:
            req.params.warehouseId,

          offerId:
            req.params.offerId,

          hidden:
            req.body.hidden,
        });

    return res.json({
      success: true,

      message:
        req.body.hidden
          ? "Позиция скрыта с сайта"
          : "Позиция восстановлена на сайте",

      ...result,
    });

  } catch(error) {
    return sendError(
      res,
      error,
      "Ошибка изменения видимости позиции"
    );
  }
}


export async function getOfferPriceHistory(
  req,
  res
) {
  try {
    const history =
      await AdminWarehouseOfferService
        .getPriceHistory({
          warehouseId:
            req.params.warehouseId,

          offerId:
            req.params.offerId,

          limit:
            req.query.limit,
        });

    return res.json({
      success: true,
      history,
    });

  } catch(error) {
    return sendError(
      res,
      error,
      "Ошибка получения истории цены"
    );
  }
}
