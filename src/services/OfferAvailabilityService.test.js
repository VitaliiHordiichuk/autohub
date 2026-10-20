import test from "node:test";
import assert from "node:assert/strict";

import {
  OFFER_AVAILABILITY,
  presentOffers,
  resolveOfferAvailability,
} from "./OfferService.js";
import { presentCartItems } from "./CartService.js";

function rawOffer(overrides = {}) {
  return {
    id: 10,
    product_id: 20,
    source_type: "OWN_STOCK",
    supplier_type: "OWN",
    quantity: 0,
    stock_quantity: 1,
    reserved_quantity: 1,
    own_reserved_quantity: 0,
    retail_price: 100,
    minimum_sale_price: 90,
    delivery_days: 0,
    is_available: true,
    is_hidden: false,
    ...overrides,
  };
}

test("sold-out stock is unavailable, not mislabeled as a cart reservation", () => {
  const [offer] = presentOffers([rawOffer()], null, "ru");

  assert.equal(offer.availabilityStatus, OFFER_AVAILABILITY.UNAVAILABLE);
  assert.equal(offer.availabilityText, "Нет предложений");
  assert.equal(offer.isAvailable, false);
  assert.equal(offer.reservationExpiresAt, null);
});

test("legacy checkout hold does not expose a misleading reserved-for-you status", () => {
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const [offer] = presentOffers([
    rawOffer({ own_reserved_quantity: 1, own_reserved_until: expiresAt }),
  ], null, "en");

  assert.equal(offer.availabilityStatus, OFFER_AVAILABILITY.UNAVAILABLE);
  assert.equal(offer.availabilityText, "No offers");
  assert.equal(offer.isAvailable, false);
  assert.equal(offer.reservationExpiresAt, null);
});

test("supplier availability remains the explicit on-order scenario", () => {
  const [offer] = presentOffers([
    rawOffer({
      source_type: "SUPPLIER",
      supplier_type: "PARTNER",
      quantity: 3,
      stock_quantity: 3,
      reserved_quantity: 0,
    }),
  ], null, "uk");

  assert.equal(offer.availabilityStatus, OFFER_AVAILABILITY.ON_ORDER);
  assert.equal(offer.availabilityText, "Під замовлення");
  assert.equal(offer.isAvailable, true);
});

test("expired reservations return to regular availability without a stock update", () => {
  assert.equal(
    resolveOfferAvailability(rawOffer({
      quantity: 1,
      reserved_quantity: 0,
      own_reserved_quantity: 0,
    })),
    OFFER_AVAILABILITY.AVAILABLE,
  );
});

test("cart never marks an offer as reserved for its owner", () => {
  const [item] = presentCartItems([{
    id: 1,
    product_offer_id: 10,
    product_id: 20,
    article: "A1",
    name: "Part",
    quantity: 1,
    available_quantity: 1,
    public_available_quantity: 0,
    stock_quantity: 1,
    reserved_quantity: 1,
    own_reserved_quantity: 1,
    own_reserved_until: "2026-10-01T12:05:00.000Z",
    retail_price: 100,
    minimum_sale_price: 90,
    source_type: "OWN_STOCK",
    is_available: true,
    is_hidden: false,
  }], null);

  assert.equal(item.availabilityStatus, OFFER_AVAILABILITY.UNAVAILABLE);
  assert.equal(item.reservationExpiresAt, null);
  assert.equal(item.availableQuantity, 1);
  assert.equal(item.isAvailable, true);
});
