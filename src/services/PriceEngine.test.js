import test from "node:test";
import assert from "node:assert/strict";

import { PriceEngine } from "./PriceEngine.js";

test("возвращает розничную цену без скидки", () => {
  const result = PriceEngine.calculate({
    retailPrice: 520,
  });

  assert.equal(result.basePrice, 520);
  assert.equal(result.customerPrice, 520);
  assert.equal(result.actualDiscountPercent, 0);
  assert.equal(result.minimumPriceApplied, false);
});

test("применяет скидку клиента", () => {
  const result = PriceEngine.calculate({
    retailPrice: 520,
    discountPercent: 5,
  });

  assert.equal(result.customerPrice, 494);
  assert.equal(result.actualDiscountPercent, 5);
});

test("не опускает цену ниже минимальной", () => {
  const result = PriceEngine.calculate({
    retailPrice: 520,
    discountPercent: 15,
    minimumPrice: 470,
  });

  assert.equal(result.customerPrice, 470);
  assert.equal(result.minimumPriceApplied, true);
  assert.equal(result.actualDiscountPercent, 9.62);
});

test("оставляет скидочную цену, если она выше минимальной", () => {
  const result = PriceEngine.calculate({
    retailPrice: 520,
    discountPercent: 5,
    minimumPrice: 470,
  });

  assert.equal(result.customerPrice, 494);
  assert.equal(result.minimumPriceApplied, false);
});

test("округляет цену до сотых", () => {
  const result = PriceEngine.calculate({
    retailPrice: 999.99,
    discountPercent: 7,
  });

  assert.equal(result.customerPrice, 929.99);
});

test("отклоняет некорректную скидку", () => {
  assert.throws(
    () =>
      PriceEngine.calculate({
        retailPrice: 520,
        discountPercent: 120,
      }),
    RangeError
  );
});