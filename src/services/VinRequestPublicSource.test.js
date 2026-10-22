import test from "node:test";
import assert from "node:assert/strict";

import { VinRequestService } from "./VinRequestService.js";
import { VinRequestRepository } from "../repositories/VinRequestRepository.js";
import { CustomerPricingService } from "./CustomerPricingService.js";

function recommendation(overrides = {}) {
  return {
    id: 1,
    product_id: 2,
    product_offer_id: 3,
    article: "TEST2",
    name: "Тестовий товар",
    retail_price: 100,
    minimum_sale_price: 100,
    quantity: 1,
    is_available: true,
    source_label: "Private supplier and warehouse",
    source_type: "OWN_STOCK",
    supplier_type: "OWN",
    warehouse_type: "OWN",
    warehouse_city: "Харків",
    ...overrides,
  };
}

test("client VIN recommendations hide internal sources; staff retain them", async () => {
  const originalClientList = VinRequestRepository.listForUser;
  const originalStaffList = VinRequestRepository.listForStaff;
  const originalContext = CustomerPricingService.getContext;
  const rows = [{ id: 10, recommendations: [
    recommendation(),
    recommendation({ id: 2, product_offer_id: 4, supplier_type: "PARTNER", warehouse_type: "SUPPLIER", source_type: "SUPPLIER", warehouse_city: "Київ" }),
  ] }];
  VinRequestRepository.listForUser = async () => rows;
  VinRequestRepository.listForStaff = async () => rows;
  CustomerPricingService.getContext = async () => ({ discountPercent: 0, isVip: false });
  try {
    const client = await VinRequestService.listForUser(1);
    const offers = client[0].recommendations.map((item) => item.offer);
    assert.deepEqual(offers.map((offer) => offer.sourceType), ["OWN_STOCK", "SUPPLIER"]);
    assert.deepEqual(offers.map((offer) => offer.warehouseCity), ["Харків", null]);
    assert.deepEqual(offers.map((offer) => offer.sourceLabel), ["Склад: Харків", "Партнерський склад"]);
    assert.equal(JSON.stringify(client).includes("Private supplier and warehouse"), false);

    const staff = await VinRequestService.listForStaff({ userId: 1 });
    assert.equal(staff[0].recommendations[0].offer.sourceLabel, "Private supplier and warehouse");
  } finally {
    VinRequestRepository.listForUser = originalClientList;
    VinRequestRepository.listForStaff = originalStaffList;
    CustomerPricingService.getContext = originalContext;
  }
});
