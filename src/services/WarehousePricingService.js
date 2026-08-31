import { PriceEngine } from "./PriceEngine.js";
import {
  IMPORT_NUMBER_LIMIT_TEXT,
  OFFER_NUMBER_MAX_EXCLUSIVE,
} from "./ImportNumericService.js";

function money(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} должна быть неотрицательным числом`);
  return Number(number.toFixed(2));
}

function offerMoney(value, label) {
  const number = money(value, label);

  if (
    number >=
    OFFER_NUMBER_MAX_EXCLUSIVE
  ) {
    throw new Error(
      `${label} превышает ${IMPORT_NUMBER_LIMIT_TEXT}. Проверьте цену в файле, выбранную колонку и настройки наценки.`
    );
  }

  return number;
}

function percent(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} должна быть неотрицательным числом`);
  return number;
}

export const WarehousePricingService = {
  calculateOfferPrices({ pricingModel, basePrice, importedRetailPrice = null,
    retailMarkupPercent = 40, minimumMarkupPercent = 10 }) {
    const base = offerMoney(basePrice, "Базовая цена");
    const minimumMarkup = percent(minimumMarkupPercent, "Минимальная наценка");
    let retailPrice;
    if (pricingModel === "OWN_DUAL_PRICE") {
      retailPrice = offerMoney(importedRetailPrice, "Розничная цена");
    } else if (pricingModel === "SUPPLIER_MARKUP") {
      const retailMarkup = percent(retailMarkupPercent, "Розничная наценка");
      retailPrice = offerMoney(base * (1 + retailMarkup / 100), "Розничная цена");
    } else {
      throw new Error("Неизвестная модель ценообразования склада");
    }
    const minimumSalePrice = offerMoney(base * (1 + minimumMarkup / 100), "Минимальная цена");
    if (minimumSalePrice > retailPrice) throw new Error("Минимальная цена не может быть выше розничной");
    return { basePrice: base, retailPrice, minimumSalePrice };
  },

  calculateCustomerPrice({ retailPrice, minimumSalePrice, discountPercent = 0, isVip = false }) {
    if (isVip) {
      const price = money(minimumSalePrice, "VIP-цена");
      return { basePrice: money(retailPrice, "Розничная цена"), customerPrice: price,
        requestedDiscountPercent: null, actualDiscountPercent: null,
        minimumPrice: price, minimumPriceApplied: true, isVipPrice: true };
    }
    return { ...PriceEngine.calculate({ retailPrice, discountPercent, minimumPrice: minimumSalePrice }), isVipPrice: false };
  },
};
