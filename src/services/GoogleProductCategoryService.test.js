import test from "node:test";
import assert from "node:assert/strict";

import {
  GOOGLE_PRODUCT_CATEGORY,
  googleProductCategoryFor,
} from "./GoogleProductCategoryService.js";


function product(overrides = {}) {
  return {
    merchant_article: "UNKNOWN",
    merchant_name: "Невідомий товар",
    merchant_brand: "Mercedes-Benz",
    merchant_product_type: null,
    merchant_categories: [],
    ...overrides,
  };
}


test("classifies real Mercedes part A0024668801 from its MAKA functional category", () => {
  const item = product({
    merchant_article: "A0024668801",
    merchant_name: "Гідронасос",
    merchant_categories: [{
      slug: "mb-group-46",
      name_uk: "46 · Рульове керування",
      parent_slug: "steering",
      parent_name_uk: "Рульове керування",
      assignment_source: "AUTO_RULE",
      confidence: 100,
    }],
  });

  assert.equal(
    googleProductCategoryFor(item),
    GOOGLE_PRODUCT_CATEGORY.vehiclePartsAndAccessories
  );
});


test("classifies real Mercedes shirt B66959811 as Shirts & Tops", () => {
  const item = product({
    merchant_article: "B66959811",
    merchant_name: "Теніска L",
    merchant_categories: [{
      slug: "mb-accessories-collection",
      name_uk: "Mercedes-Benz Collection",
      parent_slug: "mb-accessories-b",
      parent_name_uk: "Оригінальні аксесуари Mercedes-Benz",
      assignment_source: "ACCESSORY_RULE",
      confidence: 100,
    }],
  });

  assert.equal(
    googleProductCategoryFor(item),
    GOOGLE_PRODUCT_CATEGORY.shirtsAndTops
  );
  assert.notEqual(
    googleProductCategoryFor(item),
    GOOGLE_PRODUCT_CATEGORY.vehiclePartsAndAccessories
  );
});


test("does not treat the Mercedes-Benz brand as automotive evidence", () => {
  assert.equal(
    googleProductCategoryFor(product({
      merchant_name: "Парасоля",
      merchant_categories: [{
        slug: "mb-accessories-collection",
        name_uk: "Mercedes-Benz Collection",
        parent_slug: "mb-accessories-b",
      }],
    })),
    null
  );
  assert.equal(
    googleProductCategoryFor(product()),
    null
  );
});


test("does not use a shirt keyword without the supporting MAKA category", () => {
  assert.equal(
    googleProductCategoryFor(product({
      merchant_name: "Теніска L",
      merchant_categories: [{
        slug: "other",
        name_uk: "Інше",
      }],
    })),
    null
  );
});
