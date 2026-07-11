function toMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new TypeError("Цена должна быть числом");
  }

  return Number(number.toFixed(2));
}

function normalizeDiscount(discountPercent) {
  const discount = Number(discountPercent ?? 0);

  if (!Number.isFinite(discount)) {
    throw new TypeError("Скидка должна быть числом");
  }

  if (discount < 0 || discount > 100) {
    throw new RangeError("Скидка должна быть от 0 до 100");
  }

  return discount;
}

export const PriceEngine = {
  calculate({
    retailPrice,
    discountPercent = 0,
    minimumPrice = null,
  }) {
    const basePrice = toMoney(retailPrice);
    const discount = normalizeDiscount(discountPercent);

    const calculatedPrice = toMoney(
      basePrice * (1 - discount / 100)
    );

    const normalizedMinimumPrice =
      minimumPrice === null || minimumPrice === undefined
        ? null
        : toMoney(minimumPrice);

    const customerPrice =
      normalizedMinimumPrice !== null &&
      calculatedPrice < normalizedMinimumPrice
        ? normalizedMinimumPrice
        : calculatedPrice;

    return {
      basePrice,
      customerPrice,
      requestedDiscountPercent: discount,
      actualDiscountPercent: toMoney(
        ((basePrice - customerPrice) / basePrice) * 100
      ),
      minimumPrice: normalizedMinimumPrice,
      minimumPriceApplied:
        normalizedMinimumPrice !== null &&
        calculatedPrice < normalizedMinimumPrice,
    };
  },
};