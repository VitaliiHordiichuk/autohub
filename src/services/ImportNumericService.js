export const OFFER_NUMBER_MAX_EXCLUSIVE =
  100_000_000;

export const IMPORT_PRICE_MAX_EXCLUSIVE =
  10_000_000_000;

export const IMPORT_NUMBER_LIMIT_TEXT =
  "99 999 999,99";

export const PERCENT_MAX_EXCLUSIVE =
  1_000_000;


function normalizedNumber(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");

  if (!text) {
    return null;
  }

  const number = Number(text);

  return Number.isFinite(number)
    ? Number(number.toFixed(2))
    : null;
}


export function parseImportNumber(
  value,
  {
    fieldName,
    article,
    rowNumber,
  }
) {
  const valueText = String(value ?? "")
    .trim();

  const articleText =
    article || "без артикула";

  if (!valueText) {
    throw new Error(
      `Строка ${rowNumber}: отсутствует ${fieldName} для артикула ${articleText}`
    );
  }

  const number = normalizedNumber(value);

  if (number === null || number < 0) {
    throw new Error(
      `Строка ${rowNumber}: некорректное значение поля «${fieldName}» для артикула ${articleText}`
    );
  }

  if (
    number >=
    OFFER_NUMBER_MAX_EXCLUSIVE
  ) {
    throw new Error(
      `Строка ${rowNumber}: значение поля «${fieldName}» для артикула ${articleText} превышает ${IMPORT_NUMBER_LIMIT_TEXT}. Проверьте, правильно ли выбрана колонка файла.`
    );
  }

  return number;
}


export function databaseNumberOrNull(
  value,
  maxExclusive
) {
  const number = normalizedNumber(value);

  if (
    number === null ||
    Math.abs(number) >= maxExclusive
  ) {
    return null;
  }

  return number;
}


export function clampDatabasePercent(
  value
) {
  const number = Number(value);
  const maximum =
    PERCENT_MAX_EXCLUSIVE - 0.01;

  if (Number.isNaN(number)) {
    return null;
  }

  if (number === Infinity) {
    return maximum;
  }

  if (number === -Infinity) {
    return -maximum;
  }

  return Math.max(
    -maximum,
    Math.min(
      maximum,
      Number(number.toFixed(2))
    )
  );
}
