import test from "node:test";
import assert from "node:assert/strict";
import { WarehousePricingService } from "./WarehousePricingService.js";

test("свой склад использует загруженную розницу и VIP-порог", () => {
  assert.deepEqual(WarehousePricingService.calculateOfferPrices({ pricingModel: "OWN_DUAL_PRICE", basePrice: 1000, importedRetailPrice: 1500, minimumMarkupPercent: 5 }),
    { basePrice: 1000, retailPrice: 1500, minimumSalePrice: 1050 });
});

test("сторонний склад рассчитывает розницу и минимальную цену", () => {
  assert.deepEqual(WarehousePricingService.calculateOfferPrices({ pricingModel: "SUPPLIER_MARKUP", basePrice: 1000, retailMarkupPercent: 40, minimumMarkupPercent: 10 }),
    { basePrice: 1000, retailPrice: 1400, minimumSalePrice: 1100 });
});

test("VIP получает минимальную цену", () => {
  assert.equal(WarehousePricingService.calculateCustomerPrice({ retailPrice: 1500, minimumSalePrice: 1050, isVip: true }).customerPrice, 1050);
});

test("не передаёт в базу цену, которая переполнит NUMERIC", () => {
  assert.throws(
    () => WarehousePricingService.calculateOfferPrices({
      pricingModel: "SUPPLIER_MARKUP",
      basePrice: 90_000_000,
      retailMarkupPercent: 40,
      minimumMarkupPercent: 10,
    }),
    /Проверьте цену в файле, выбранную колонку и настройки наценки/
  );
});
