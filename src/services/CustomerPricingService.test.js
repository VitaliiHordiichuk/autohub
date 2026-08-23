import test from "node:test";
import assert from "node:assert/strict";

import { CustomerPricingService } from "./CustomerPricingService.js";


test(
  "матрица сотрудника не дублирует розницу и сохраняет порядок групп",
  () => {
    const rows = CustomerPricingService.priceMatrix(
      {
        retailPrice: 1000,
        minimumSalePrice: 700,
      },
      {
        showAllPrices: true,
        priceGroups: [
          {
            id: 1,
            name: "Registered",
            discountPercent: 5,
            pricingMode: "DISCOUNT",
          },
          {
            id: 2,
            name: "GOLD",
            discountPercent: 25,
            pricingMode: "DISCOUNT",
          },
          {
            id: 3,
            name: "VIP",
            discountPercent: 0,
            pricingMode: "MINIMUM",
          },
        ],
      }
    );

    assert.deepEqual(
      rows?.map((row) => ({
        name: row.name,
        price: row.price,
      })),
      [
        { name: "Registered", price: 950 },
        { name: "GOLD", price: 750 },
        { name: "VIP", price: 700 },
      ]
    );
  }
);

test("позиция без розничной цены не ломает матрицу сотрудника", () => {
  const context = {
    showAllPrices: true,
    priceGroups: [
      {
        id: 1,
        name: "Registered",
        discountPercent: 5,
        pricingMode: "DISCOUNT",
      },
    ],
  };

  assert.equal(
    CustomerPricingService.priceMatrix(
      { retailPrice: null, minimumSalePrice: null },
      context
    ),
    null
  );
  assert.equal(
    CustomerPricingService.priceMatrix(
      { retailPrice: "", minimumSalePrice: null },
      context
    ),
    null
  );
  assert.equal(
    CustomerPricingService.priceMatrix(
      { retailPrice: 0, minimumSalePrice: 0 },
      context
    ),
    null
  );
});

test("некорректная цена предложения возвращает null вместо ошибки", () => {
  const context = {
    discountPercent: 5,
    isVip: false,
  };

  assert.equal(
    CustomerPricingService.price(
      { retailPrice: null, minimumSalePrice: null },
      context
    ),
    null
  );
  assert.equal(
    CustomerPricingService.price(
      { retailPrice: 0, minimumSalePrice: 0 },
      context
    ),
    null
  );
});
