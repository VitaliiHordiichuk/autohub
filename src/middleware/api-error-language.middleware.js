const RUSSIAN_ERROR_MARKERS =
  /[ыэёъ]|ошибк|не удалось|требуется|обязател|некорректн|пользовател|заказ|корзин|сесси|недостаточно|долж(?:ен|на|но|ны)|слишком|нельзя|выберите|укажите|введите|отсутству|не найден|заблокирован|получател|поставщик|возврат|изображени|цен|количеств|названи|предложени|сотрудник|клиент|нов(?:ый|ая|ое|ые)|строк|страниц|размер|значени|письм/i;

function requestLocale(req) {
  const explicit = String(
    req.query?.locale ||
    req.body?.locale ||
    req.get("X-Site-Locale") ||
    ""
  ).trim().toLowerCase();

  if (explicit === "en") return "en";

  const referer = String(req.get("Referer") || "");
  if (/\/en(?:\/|$)/i.test(referer)) return "en";

  return "uk";
}

function localizedFallback(locale, statusCode) {
  if (locale === "en") {
    return statusCode >= 500
      ? "Internal server error"
      : "The action could not be completed. Check the data and try again.";
  }

  return statusCode >= 500
    ? "Внутрішня помилка сервера"
    : "Не вдалося виконати дію. Перевірте дані та спробуйте ще раз.";
}

function withoutRussianErrorText(payload, locale, statusCode) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return payload;
  }

  let changed = false;
  const result = { ...payload };

  for (const key of ["error", "message"]) {
    const value = result[key];
    if (typeof value === "string" && RUSSIAN_ERROR_MARKERS.test(value)) {
      result[key] = localizedFallback(locale, statusCode);
      changed = true;
    }
  }

  return changed ? result : payload;
}

export function enforceApiErrorLanguage(req, res, next) {
  const sendJson = res.json.bind(res);

  res.json = (payload) => sendJson(
    res.statusCode >= 400
      ? withoutRussianErrorText(payload, requestLocale(req), res.statusCode)
      : payload
  );

  next();
}

export const apiErrorLanguageTest = {
  withoutRussianErrorText,
};
