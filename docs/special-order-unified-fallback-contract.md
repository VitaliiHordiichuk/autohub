# MAKA Mercedes TXT inquiry fallback — experimental backend read model

## Preconditions (all required before future deployment)
- **Feature OFF by default:** `SPECIAL_ORDER_TXT_FALLBACK_ENABLED` must remain unset or `false` on production, staging, and Telegram worker until frontend and lead/contact flow are reviewed.
- Do not merge or deploy this backend branch; production database does not have migration 125 and no active TXT revision.
- The tested 1.54m-row TXT remains on an **isolated PostgreSQL cluster** on port 5545, not on production port 5432. Its `special_order_sources.active_import_id` is NULL/absent.
- The isolated lookup suite succeeded against real data: Guest/Registered 13,188.75 UAH and GOLD/VIP 10,522.94 UAH for `A4058819501`. All six price conflicts were suppressed. An indexed query's warm-cache `EXPLAIN ANALYZE` execution time was 0.108 ms. This is not a production latency guarantee.

## One shared search decision
Both the public website article endpoint and the private MAKAtron bridge use `readWebsiteArticleSearch`.

1. Execute the existing `SearchService`, normal website family/replacement logic, and public offer presentation **first**.
2. If any **eligible public offer** exists among exact product, family, analogs, replacements or replacement source, return normal response, with **no TXT lookup**. A valid offer must be available, with positive quantity and price (same `isEligiblePublicOffer` as current site).
3. If no eligible public offer exists, optionally look up the **exact normalized second TXT article** using the logged-in customer's `CustomerPricingService.priceGroupName`.
4. Only attach a separate `response.specialOrder` inquiry object. Never create `products`, `product_offers`, `productCard.offers`, cart lines, deliveries, Merchant feed records or sitemap URLs from TXT rows.
5. If no TXT row exists, the previous not-found response remains unchanged.
6. Errors querying the optional TXT source must not cause the existing catalogue to fail.

## Inquiry contract (proposed, requires frontend agreement)
```json
{
  "specialOrder": {
    "source": "MERCEDES_TXT",
    "article": "A4058819501",
    "name": "Запчастина для Mercedes-Benz",
    "status": "SPECIAL_ORDER_INQUIRY",
    "priceUah": 13188.75,
    "currency": "UAH",
    "isEstimated": true,
    "isAvailable": false,
    "checkoutEligible": false,
    "requiresManagerConfirmation": true
  }
}
```
- On an existing unstocked product, this object is appended to the familiar search response alongside its existing product card.
- On a catalogue miss with a TXT match, the service returns HTTP-search success and a `productCard: null`, `family: []`, and a separate inquiry object. It is not an existing SKU.
- No contact button, phone-collection endpoint, frontend card, MAKAtron inquiry renderer, email, manager lead, or anti-spam mechanism has been implemented yet. Do not turn on the feature until that work and end-to-end tests are complete.
- Names remain as provided by the TXT; fallback descriptions for blank names are localized to uk/ru/en. Translating German names requires its own reviewed workflow.

## Safety conditions / tests
- Existing warehouse/partner offers always win, even when an original article lacks inventory but a valid family/analog/replacement offer exists.
- Six ambiguous TXT articles remain rejected by `SpecialOrderLookupService` SQL guard.
- Staff private prices and Telegram quote endpoints remain unchanged; TXT pricing is not a warehouse offer.
- Existing responses stay identical if the feature flag is false.
- Website + bot must share this read model, but bot needs an explicit **inquiry** UI path; the current normal offer cards never synthesize a product ID for TXT records.
- Do not apply migration 125 or activate an import on production as part of this PR.
