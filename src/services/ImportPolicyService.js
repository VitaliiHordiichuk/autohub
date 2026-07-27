export const NEW_PRODUCTS_MODES = [
  "REVIEW",
  "AUTO",
  "IGNORE",
];

export function normalizeNewProductsMode(
  value,
  {
    fallback = "REVIEW",
    allowUndefined = false,
  } = {}
) {
  if (
    allowUndefined &&
    value === undefined
  ) {
    return undefined;
  }

  const normalized = String(
    value ?? fallback
  )
    .trim()
    .toUpperCase();

  if (
    !NEW_PRODUCTS_MODES.includes(
      normalized
    )
  ) {
    throw new Error(
      "Режим новых товаров должен быть REVIEW, AUTO или IGNORE"
    );
  }

  return normalized;
}

export function normalizePriceThreshold(
  value,
  label,
  {
    fallback,
    allowUndefined = false,
  } = {}
) {
  if (
    allowUndefined &&
    value === undefined
  ) {
    return undefined;
  }

  const normalizedValue =
    value === null || value === ""
      ? fallback
      : value;

  const number = Number(
    String(normalizedValue)
      .trim()
      .replace(",", ".")
  );

  if (
    !Number.isFinite(number) ||
    number < 0 ||
    number > 100000
  ) {
    throw new Error(
      `${label}: укажите число от 0 до 100000`
    );
  }

  return Number(number.toFixed(2));
}

export function calculatePriceChangePercent(
  oldPrice,
  newPrice
) {
  const oldValue = Number(oldPrice);
  const newValue = Number(newPrice);

  if (
    !Number.isFinite(oldValue) ||
    !Number.isFinite(newValue) ||
    oldValue <= 0
  ) {
    return null;
  }

  const change =
    ((newValue - oldValue) /
      oldValue) *
    100;

  return Number(change.toFixed(2));
}

export function classifyPriceChange({
  changePercent,
  dropThreshold,
  riseThreshold,
}) {
  if (
    changePercent === null ||
    changePercent === 0
  ) {
    return "IMPORTED";
  }

  if (
    changePercent <
    -Math.abs(Number(dropThreshold))
  ) {
    return "PRICE_DROP_ALERT";
  }

  if (
    changePercent >
    Math.abs(Number(riseThreshold))
  ) {
    return "PRICE_RISE_ALERT";
  }

  return "IMPORTED";
}
