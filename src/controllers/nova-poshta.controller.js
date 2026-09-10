import {
  NovaPoshtaService,
} from "../services/NovaPoshtaService.js";

function requestLocale(req) {
  return req.query.locale === "ru" ? "ru" : "uk";
}

function fail(res, error, label) {
  console.error(label, error);

  return res
    .status(error.statusCode || 500)
    .json({
      success: false,
      code:
        error.code ||
        "NOVA_POSHTA_UNAVAILABLE",
      error:
        error.message ||
        "Сервіс Нової пошти тимчасово недоступний",
    });
}

export async function searchNovaPoshtaCities(
  req,
  res
) {
  try {
    const cities =
      await NovaPoshtaService.searchCities(
        req.query.query,
        { locale: requestLocale(req) }
      );

    return res.json({
      success: true,
      cities,
    });
  } catch (error) {
    return fail(
      res,
      error,
      "Помилка пошуку міст Нової пошти:"
    );
  }
}

export async function searchNovaPoshtaPoints(
  req,
  res
) {
  try {
    const points =
      await NovaPoshtaService.searchPoints(
        req.query.cityRef,
        req.query.query,
        { locale: requestLocale(req) }
      );

    return res.json({
      success: true,
      points,
    });
  } catch (error) {
    return fail(
      res,
      error,
      "Помилка пошуку відділень Нової пошти:"
    );
  }
}

