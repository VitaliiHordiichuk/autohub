import test from "node:test";
import assert from "node:assert/strict";

import { PublicSearchSuggestionRepository } from "../repositories/PublicSearchSuggestionRepository.js";
import { CustomerPricingService } from "../services/CustomerPricingService.js";
import { OfferService } from "../services/OfferService.js";
import { searchByText } from "./search.controller.js";

test("text search loads offers for the result page in one batch", async () => {
  const originalSearch = PublicSearchSuggestionRepository.search;
  const originalGetContext = CustomerPricingService.getContext;
  const originalGetByIds = OfferService.getOffersByProductIds;
  const originalGetById = OfferService.getOffersByProductId;
  const products = [
    { id: 101, article: "A101" },
    { id: 102, article: "A102" },
    { id: 103, article: "A103" },
  ];
  const calls = [];

  PublicSearchSuggestionRepository.search = async () => ({
    products,
    pagination: { page: 2, pageSize: 24, total: 27, pages: 2 },
  });
  CustomerPricingService.getContext = async () => ({ discountPercent: 0, isVip: false });
  OfferService.getOffersByProductIds = async (productIds, pricingContext, locale) => {
    calls.push({ productIds, pricingContext, locale });
    return new Map(productIds.map((productId) => [Number(productId), [{
      id: productId + 1000,
      retailPrice: productId,
      isAvailable: true,
      availabilityText: "В наявності",
      sourceLabel: "Наш склад",
    }]]));
  };
  OfferService.getOffersByProductId = async () => {
    throw new Error("per-product offer lookup must not be used");
  };

  const response = {
    statusCode: 200,
    set() { return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return value; },
  };

  try {
    await searchByText({
      query: { q: "Mercedes", locale: "uk", page: 2 },
      auth: null,
    }, response);
  } finally {
    PublicSearchSuggestionRepository.search = originalSearch;
    CustomerPricingService.getContext = originalGetContext;
    OfferService.getOffersByProductIds = originalGetByIds;
    OfferService.getOffersByProductId = originalGetById;
  }

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.map((call) => call.productIds), [[101, 102, 103]]);
  assert.equal(calls[0].locale, "uk");
  assert.deepEqual(response.body.products.map((product) => product.id), [101, 102, 103]);
  assert.deepEqual(response.body.products.map((product) => product.offers[0].id), [1101, 1102, 1103]);
});
