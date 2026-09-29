import test from "node:test";
import assert from "node:assert/strict";
import { ReturnPolicyService } from "./ReturnPolicyService.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { presentCartItems } from "./CartService.js";
import { presentOffers, selectPrimaryPublicOffer } from "./OfferService.js";
import { mapPublicOffer } from "./PublicSeoService.js";
import { assertOrderItemReturnable } from "./OrderReturnService.js";
import { orderItemReturnabilitySnapshot } from "../use-cases/checkout/SubmitOrder.js";

const cases = [
  [{}, { policy: "RETURNABLE", source: "ORGANIZATION" }],
  [{ warehouseOverride: "NON_RETURNABLE" }, { policy: "NON_RETURNABLE", source: "WAREHOUSE" }],
  [{ warehouseOverride: "NON_RETURNABLE", productOverride: "RETURNABLE" }, { policy: "RETURNABLE", source: "PRODUCT" }],
  [{ warehouseOverride: "RETURNABLE", productOverride: "RETURNABLE", offerOverride: "NON_RETURNABLE" }, { policy: "NON_RETURNABLE", source: "OFFER" }],
  [{ warehouseOverride: "NON_RETURNABLE", productOverride: "NON_RETURNABLE", offerOverride: "RETURNABLE" }, { policy: "RETURNABLE", source: "OFFER" }],
  [{ warehouseOverride: "INHERIT", productOverride: "INHERIT", offerOverride: "INHERIT" }, { policy: "RETURNABLE", source: "ORGANIZATION" }],
];

for (const [input, expected] of cases) {
  test(`resolve ${JSON.stringify(input)}`, () => {
    assert.deepEqual(ReturnPolicyService.resolve(input), expected);
  });
}

test("checkout snapshots the effective policy of the selected offer", () => {
  assert.equal(orderItemReturnabilitySnapshot({
    offer_return_policy_override: "INHERIT",
    product_return_policy_override: "INHERIT",
    warehouse_return_policy_override: "NON_RETURNABLE",
  }), false);
  assert.equal(orderItemReturnabilitySnapshot({
    offer_return_policy_override: "RETURNABLE",
    product_return_policy_override: "NON_RETURNABLE",
    warehouse_return_policy_override: "NON_RETURNABLE",
  }), true);
});

function rawOffer(overrides = {}) {
  return {
    id: 7,
    product_id: 11,
    warehouse_id: 13,
    supplier_id: null,
    effective_supplier_id: null,
    quantity: 2,
    purchase_price: 80,
    retail_price: 120,
    minimum_sale_price: 100,
    source_type: "OWN_STOCK",
    supplier_type: "OWN",
    is_available: true,
    is_hidden: false,
    delivery_days: 0,
    offer_return_policy_override: "INHERIT",
    product_return_policy_override: "NON_RETURNABLE",
    warehouse_return_policy_override: "RETURNABLE",
    ...overrides,
  };
}

test("ProductRepository returns the effective policy without consulting legacy booleans", async () => {
  const db = {
    async query(sql) {
      assert.match(sql, /p\.return_policy_override AS product_return_policy_override/);
      return { rows: [rawOffer()] };
    },
  };
  const offer = await ProductRepository.findOfferById(7, db);
  assert.deepEqual(offer.returnPolicy, {
    policy: "NON_RETURNABLE",
    source: "PRODUCT",
  });
  assert.equal(offer.isReturnable, false);
});

test("OfferService and SEO preserve the policy of the already selected D11 offer", () => {
  const presented = presentOffers([
    rawOffer({ id: 7, product_return_policy_override: "INHERIT", offer_return_policy_override: "NON_RETURNABLE" }),
    rawOffer({ id: 8, retail_price: 90, supplier_type: "PARTNER", source_type: "SUPPLIER", offer_return_policy_override: "RETURNABLE" }),
  ], null, "uk");
  const selected = selectPrimaryPublicOffer(presented);
  assert.equal(selected.id, 7);
  assert.equal(selected.retailPrice, 120);
  assert.deepEqual(selected.returnPolicy, {
    policy: "NON_RETURNABLE",
    source: "OFFER",
  });
  assert.deepEqual(mapPublicOffer(selected).returnPolicy, selected.returnPolicy);
});

test("cart presentation recalculates the effective policy from current offer data", () => {
  const items = presentCartItems([{
    ...rawOffer(),
    id: 21,
    cart_id: 22,
    product_offer_id: 7,
    article: "A0000000001",
    name: "Test part",
    available_quantity: 2,
    created_at: "2026-09-29T00:00:00.000Z",
    updated_at: "2026-09-29T00:00:00.000Z",
  }], null);
  assert.deepEqual(items[0].returnPolicy, {
    policy: "NON_RETURNABLE",
    source: "PRODUCT",
  });
  assert.equal(items[0].isReturnable, false);
});

test("order item persists the checkout snapshot and returns use that historical value", async () => {
  let insertParams;
  const db = {
    async query(_sql, params) {
      insertParams = params;
      return { rows: [{ id: 31, is_returnable: params[5] }] };
    },
  };
  const created = await OrderRepository.addOrderItem({
    orderId: 1,
    productId: 11,
    productOfferId: 7,
    quantity: 1,
    priceAtPurchase: 120,
    isReturnable: false,
  }, db);
  assert.equal(insertParams[5], false);
  assert.equal(created.is_returnable, false);
  assert.throws(
    () => assertOrderItemReturnable({ article: "A0000000001", is_returnable: false }),
    /возврату не подлежит/
  );
  assert.doesNotThrow(
    () => assertOrderItemReturnable({ article: "A0000000001", is_returnable: true })
  );
});
