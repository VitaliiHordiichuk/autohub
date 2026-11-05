import test from "node:test";
import assert from "node:assert/strict";
import {
  hasEligibleWebsiteOffers,
  readSpecialOrderFallback,
} from "../src/services/SpecialOrderFallbackService.js";
import { readWebsiteArticleSearch } from "../src/services/WebsiteArticleSearchService.js";

const article = "A4058819501";
function eligibleOffer() {
  return { id: 1, quantity: 2, retailPrice: 200, isAvailable: true };
}
function inquiry() {
  return {
    article, name: null, priceUah: 10522.94, currency: "UAH",
    status: "SPECIAL_ORDER_INQUIRY", requiresManagerConfirmation: true,
  };
}

test("feature off: never calls TXT and preserves no-match HTTP read-model response", async () => {
  let calls = 0;
  const result = await readWebsiteArticleSearch({ article }, {
    specialOrderEnabled: false,
    search: async () => ({ found: false, normalized: article }),
    specialOrder: async () => { calls++; throw Error("TXT called"); },
    pricing: async () => { throw Error("Pricing should not be loaded"); },
  });
  assert.equal(calls, 0);
  assert.equal(result.found, false);
  assert.deepEqual(result.response, {
    success: false, query: article, normalized: article,
    message: "Товар не знайдено",
  });
});

test("feature on: not-found catalogue article returns inquiry only, not a product offer", async () => {
  const result = await readWebsiteArticleSearch({
    article, requestedLocale: "ru", userId: 4,
  }, {
    specialOrderEnabled: true,
    search: async () => ({ found: false, normalized: article }),
    pricing: async userId => {
      assert.equal(userId, 4);
      return { priceGroupName: "GOLD" };
    },
    specialOrder: async args => {
      assert.equal(args.pricingContext.priceGroupName, "GOLD");
      assert.equal(args.publicResult, null);
      return {
        source: "MERCEDES_TXT", article, name: "Запчасти на Mercedes-Benz",
        status: "SPECIAL_ORDER_INQUIRY", priceUah: 10522.94, currency: "UAH",
        isEstimated: true, isAvailable: false, checkoutEligible: false,
        requiresManagerConfirmation: true,
      };
    },
  });
  assert.equal(result.found, true);
  assert.equal(result.specialOrderOnly, true);
  assert.equal(result.response.productCard, null);
  assert.deepEqual(result.response.family, []);
  assert.equal(result.response.specialOrder.checkoutEligible, false);
  assert.equal(result.response.specialOrder.priceUah, 10522.94);
});

test("no TXT match: still reports normal product-not-found", async () => {
  const result = await readWebsiteArticleSearch({ article }, {
    specialOrderEnabled: true,
    search: async () => ({ found: false, normalized: article }),
    pricing: async () => ({ priceGroupName: "Guest" }),
    specialOrder: async () => null,
  });
  assert.equal(result.found, false);
  assert.equal(result.response.success, false);
  assert.equal(result.response.specialOrder, undefined);
});

test("eligibility checks rendered exact, family, analog, replacement and source offers", () => {
  const present = {
    productCard: {
      offers: [{ quantity: 0, retailPrice: 10, isAvailable: false }],
      analogs: [{ offers: [eligibleOffer()] }],
    },
  };
  assert.equal(hasEligibleWebsiteOffers(present), true);
  assert.equal(hasEligibleWebsiteOffers({
    family: [{ offers: [eligibleOffer()] }],
  }), true);
  assert.equal(hasEligibleWebsiteOffers({
    replacementSourceCard: { offers: [eligibleOffer()] },
  }), true);
  assert.equal(hasEligibleWebsiteOffers({
    productCard: { replacements: [{ offers: [eligibleOffer()] }] },
  }), true);
  assert.equal(hasEligibleWebsiteOffers({
    productCard: { offers: [{ quantity: 1, retailPrice: 500, isAvailable: false }] },
  }), false);
});

test("available partner or MAKA offer: never query TXT", async () => {
  let queries = 0;
  const result = await readSpecialOrderFallback({
    article, searchResult: { found: true },
    pricingContext: { priceGroupName: "Guest" },
    publicResult: { family: [{ offers: [eligibleOffer()] }] },
  }, { enabled: true, lookup: async () => { queries++; return [inquiry()]; } });
  assert.equal(result, null);
  assert.equal(queries, 0);
});

test("existing catalogue item without eligible offers: TXT inquiry, not inventory", async () => {
  let searchedGroup;
  const result = await readSpecialOrderFallback({
    article, requestedLocale: "uk",
    searchResult: { found: true },
    pricingContext: { priceGroupName: "GOLD" },
    publicResult: {
      productCard: {
        offers: [{ isAvailable: false, quantity: 0, retailPrice: 500 }],
        analogs: [],
        replacements: [],
      },
      family: [],
    },
  }, {
    enabled: true,
    lookup: async args => { searchedGroup = args.priceGroupName; return [inquiry()]; },
  });
  assert.equal(searchedGroup, "GOLD");
  assert.equal(result.name, "Запчастина для Mercedes-Benz");
  assert.equal(result.status, "SPECIAL_ORDER_INQUIRY");
  assert.equal(result.checkoutEligible, false);
  assert.equal(result.isEstimated, true);
});

test("do not fall back if catalogue was found but public eligibility is unresolved", async () => {
  const result = await readSpecialOrderFallback({
    article, searchResult: { found: true }, publicResult: null,
  }, { enabled: true, lookup: async () => { throw Error("must not run"); } });
  assert.equal(result, null);
});

test("TXT query fails: do not break existing catalogue search", async () => {
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal(await readSpecialOrderFallback({
      article, searchResult: { found: false }, pricingContext: {},
    }, {
      enabled: true, lookup: async () => { throw Error("test unavailable"); },
    }), null);
  } finally {
    console.error = error;
  }
});

test("reject malformed or ambiguous TXT candidates, never offer cart action", async () => {
  const args = { article, searchResult: { found: false }, publicResult: null };
  for (const rows of [
    [inquiry(), inquiry()], 
    [{ ...inquiry(), priceUah: 0 }],
    [{ ...inquiry(), requiresManagerConfirmation: false }],
    [{ ...inquiry(), currency: "EUR" }],
  ]) {
    const result = await readSpecialOrderFallback(args, {
      enabled: true, lookup: async () => rows,
    });
    assert.equal(result, null);
  }
});

test("found existing family without inventory: preserve catalog cards and append inquiry", async () => {
  const item = { id: 12, article };
  const result = await readWebsiteArticleSearch({
    article, requestedLocale: "uk",
  }, {
    specialOrderEnabled: true,
    search: async () => ({
      found: true, query: article, normalized: article, rule: "MERCEDES",
      exactProduct: item, family: [item], replacementPath: [],
    }),
    pricing: async () => ({ priceGroupName: "Guest" }),
    buildCard: async product => ({ product, offers: [], analogs: [], replacements: [] }),
    present: async ({ productCard, family }) => ({
      locale: "uk", productCard, family, replacementSourceCard: null,
    }),
    specialOrder: async () => ({
      source: "MERCEDES_TXT", article, name: "Запчастина",
      priceUah: 13188.75, isAvailable: false,
      checkoutEligible: false, status: "SPECIAL_ORDER_INQUIRY",
    }),
  });
  assert.equal(result.found, true);
  assert.equal(result.response.productCard.product.id, 12);
  assert.equal(result.response.productCard.offers.length, 0);
  assert.equal(result.response.specialOrder.checkoutEligible, false);
});
