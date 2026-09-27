import test from "node:test";
import assert from "node:assert/strict";

import { SupplierRepository } from "../repositories/SupplierRepository.js";
import { OfferService } from "./OfferService.js";
import { MercedesFamilyOfferService } from "./MercedesFamilyOfferService.js";

test("Mercedes family loads candidate offers in one batch and preserves filtering", async () => {
  const originalSupplierLookup = SupplierRepository.findEnabledSupplierIdsByArticleSearchRule;
  const originalGetByIds = OfferService.getOffersByProductIds;
  const originalGetById = OfferService.getOffersByProductId;
  const calls = [];

  SupplierRepository.findEnabledSupplierIdsByArticleSearchRule = async () => [7];
  OfferService.getOffersByProductIds = async (productIds, pricingContext) => {
    calls.push({ productIds, pricingContext });
    return new Map([
      [2, [
        { id: 21, supplier: { id: 7 } },
        { id: 22, supplier: { id: 9 } },
      ]],
      [3, [{ id: 31, supplier: { id: 7 } }]],
    ]);
  };
  OfferService.getOffersByProductId = async () => {
    throw new Error("per-product offer lookup must not be used");
  };

  let result;
  try {
    result = await MercedesFamilyOfferService.build({
      family: [{ id: 1 }, { id: 2 }, { id: 3 }],
      exactProductId: 1,
      requireEnabledSupplierRule: true,
      pricingContext: { discountPercent: 5 },
    });
  } finally {
    SupplierRepository.findEnabledSupplierIdsByArticleSearchRule = originalSupplierLookup;
    OfferService.getOffersByProductIds = originalGetByIds;
    OfferService.getOffersByProductId = originalGetById;
  }

  assert.deepEqual(calls.map((call) => call.productIds), [[2, 3]]);
  assert.deepEqual(result.map((item) => item.product.id), [2, 3]);
  assert.deepEqual(result[0].offers.map((offer) => offer.id), [21]);
  assert.deepEqual(result[1].offers.map((offer) => offer.id), [31]);
});
