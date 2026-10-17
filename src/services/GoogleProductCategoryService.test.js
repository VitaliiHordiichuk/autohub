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


test("classifies approved customer taxonomy Mercedes parts with legacy Other", () => {
  const examples = [
    { slug: "steering-pumps", root_slug: "steering" },
    { slug: "engine-intake-manifolds-throttle", root_slug: "engine" },
  ];
  for (const category of examples) {
    assert.equal(
      googleProductCategoryFor(product({
        merchant_categories: [{ slug: "other" }],
        merchant_customer_category: { ...category, approval_status: "AUTO_APPROVED" },
      })),
      GOOGLE_PRODUCT_CATEGORY.vehiclePartsAndAccessories
    );
  }
});

test("customer collection classifies shirts but not other accessories", () => {
  const category = {
    slug: "accessories-collection",
    root_slug: "accessories",
    approval_status: "AUTO_APPROVED",
  };
  assert.equal(
    googleProductCategoryFor(product({
      merchant_name: "Теніска L",
      merchant_categories: [{ slug: "other" }],
      merchant_customer_category: category,
    })),
    GOOGLE_PRODUCT_CATEGORY.shirtsAndTops
  );
  assert.equal(
    googleProductCategoryFor(product({
      merchant_name: "Парасоля",
      merchant_customer_category: category,
    })),
    null
  );
});

test("ignores unapproved or unknown customer category evidence", () => {
  assert.equal(
    googleProductCategoryFor(product({
      merchant_categories: [{ slug: "other" }],
      merchant_customer_category: {
        slug: "steering-pumps",
        root_slug: "steering",
        approval_status: "REVIEW",
      },
    })),
    null
  );
  assert.equal(
    googleProductCategoryFor(product({
      merchant_customer_category: {
        slug: "accessories-collection",
        root_slug: "accessories",
        approval_status: "MANUAL_APPROVED",
      },
      merchant_name: "Без назви",
    })),
    null
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
