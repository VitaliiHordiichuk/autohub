import test from "node:test";
import assert from "node:assert/strict";

import {
  OFFER_AVAILABILITY,
  presentPublicOffers,
  selectPrimaryPublicOffer,
} from "./OfferService.js";


function rawOffer(id, overrides = {}) {
  return {
    id,
    product_id: 101,
    product_active: true,
    warehouse_id: id,
    supplier_id: 77,
    effective_supplier_id: 77,
    quantity: 2,
    stock_quantity: 2,
    reserved_quantity: 0,
    own_reserved_quantity: 0,
    retail_price: 100,
    minimum_sale_price: 80,
    price_mode: "AUTO",
    manual_retail_price: null,
    delivery_days: 0,
    source_type: "OWN_STOCK",
    is_available: true,
    is_hidden: false,
    offer_return_policy_override: "INHERIT",
    product_return_policy_override: "INHERIT",
    warehouse_return_policy_override: "INHERIT",
    warehouse_name: `Warehouse ${id}`,
    warehouse_city: "Kyiv",
    warehouse_priority: id,
    warehouse_active: true,
    supplier_name: "MAKA",
    supplier_type: "OWN",
    supplier_active: true,
    warehouse_priority_enabled: true,
    ...overrides,
  };
}


function primary(rows) {
  return selectPrimaryPublicOffer(
    presentPublicOffers(
      rows,
      null,
      "uk"
    )
  );
}


test("public selection keeps warehouse priority ahead of a lower price", () => {
  const selected = primary([
    rawOffer(1, { retail_price: 200, minimum_sale_price: 180 }),
    rawOffer(2, { retail_price: 100, minimum_sale_price: 80 }),
  ]);

  assert.equal(selected.id, 1);
  assert.equal(selected.retailPrice, 200);
});


for (const [name, blocked] of [
  ["zero price", { retail_price: 0 }],
  ["negative price", { retail_price: -1 }],
  ["null price", { retail_price: null }],
  ["inactive product", { product_active: false }],
  ["hidden offer", { is_hidden: true }],
  ["inactive offer", { is_available: false }],
  ["inactive warehouse", { warehouse_active: false }],
  ["inactive supplier", { supplier_active: false }],
  ["zero physical quantity", { quantity: 0, stock_quantity: 0 }],
  ["fully reserved stock", {
    quantity: 0,
    stock_quantity: 1,
    reserved_quantity: 1,
  }],
]) {
  test(`public selection falls back from priority 1 with ${name}`, () => {
    const selected = primary([
      rawOffer(1, blocked),
      rawOffer(2, { retail_price: 150, minimum_sale_price: 120 }),
    ]);

    assert.equal(selected.id, 2);
    assert.equal(selected.retailPrice, 150);
  });
}


test("public selection preserves source order across different suppliers", () => {
  const selected = primary([
    rawOffer(1, {
      effective_supplier_id: 70,
      supplier_id: 70,
      retail_price: 200,
    }),
    rawOffer(2, {
      effective_supplier_id: 80,
      supplier_id: 80,
      retail_price: 100,
      supplier_name: "Partner",
      supplier_type: "PARTNER",
      source_type: "SUPPLIER",
    }),
  ]);

  assert.equal(selected.id, 1);
  assert.equal(selected.retailPrice, 200);
});


test("public selection uses the repository effective manual price", () => {
  const selected = primary([
    rawOffer(1, {
      price_mode: "MANUAL",
      manual_retail_price: 175,
      retail_price: 175,
      minimum_sale_price: 120,
    }),
    rawOffer(2, {
      retail_price: 150,
      minimum_sale_price: 120,
    }),
  ]);

  assert.equal(selected.id, 1);
  assert.equal(selected.retailPrice, 175);
});


test("selected return policy belongs to the eligible fallback offer", () => {
  const selected = primary([
    rawOffer(1, {
      retail_price: 0,
      offer_return_policy_override: "NON_RETURNABLE",
    }),
    rawOffer(2, {
      retail_price: 150,
      offer_return_policy_override: "RETURNABLE",
    }),
  ]);

  assert.equal(selected.id, 2);
  assert.deepEqual(selected.returnPolicy, {
    policy: "RETURNABLE",
    source: "OFFER",
  });
});


test("reserved offer remains informational only when no commercial offer exists", () => {
  const offers = presentPublicOffers([
    rawOffer(1, {
      quantity: 0,
      stock_quantity: 1,
      reserved_quantity: 1,
    }),
    rawOffer(2, { retail_price: 0 }),
  ], null, "uk");

  assert.equal(offers.length, 1);
  assert.equal(offers[0].id, 1);
  assert.equal(
    offers[0].availabilityStatus,
    OFFER_AVAILABILITY.RESERVED
  );
  assert.equal(
    selectPrimaryPublicOffer(offers),
    null
  );
});
