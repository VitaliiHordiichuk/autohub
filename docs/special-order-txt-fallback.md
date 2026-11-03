# MAKA: TXT-only special-order fallback (work in progress)

## Agreed product behavior
1. Search the existing MAKA warehouse and partners first using the unified website search.
2. If ANY eligible, available on-hand/partner offer exists, do not query special-order TXT.
3. Otherwise look up the **second article** from the TXT by normalized exact article, without creating products, catalog pages, Merchant entries or sitemaps.
4. Use the **second discount group** exactly, not a number embedded in a textual code.
5. Display optional product name only when present in the file; status "Під замовлення / Под заказ"; estimated UAH price; contact-manager / leave-phone action. This is an **inquiry**, not a confirmed order or availability.
6. If no approved TXT row exists, preserve the ordinary "Товар не знайдено" response.
7. This fallback must eventually use the same read model in website and MAKAtron, with no separate bot pricing algorithm.

## Pricing (not the ordinary catalog pricing)
- TXT retail price is **UAH excluding VAT**.
- Multiply by 1.20 to include VAT; then apply user-tier group discount, round to 2 digits only once.
- GOLD and VIP use FIRST percentage in user's matrix; Guest and Registered use SECOND.
- Full-token approved groups:
  - 00: 0% premium / 0% standard
  - 03,05,08,081,082,083,08s,081s,082s,083s,09: 5% / 1%
  - 10,13,13s,16,16s,17,18,20,20s,23,26,28,30,30s,32,35,38,38s,40,40s,43,46,50,52,54: 25% / 6%
  - 55 through 72 inclusive: 7% / 2%
- Any other group is excluded, including drt116, evo220, 116, 220. No substring or numeric extraction.
- Example: second article A4058819501, group 20, TXT 11692.15 UAH:
  Guest/Registered = 13188.75 UAH; GOLD/VIP = 10522.94 UAH.

## Prepared in this branch
- Pure, tested price rules: `src/services/SpecialOrderPricingService.js`
- Indexed revisioned storage design: `migrations/125_special_order_txt_fallback.sql` (**NOT APPLIED**)
- Read-only lookup candidate helper: `src/services/SpecialOrderLookupService.js`.
- No changes to existing search endpoints or frontend; feature is **NOT LIVE**.

## Next safe engineering steps
1. Obtain **10-20 RAW TXT lines**, not a screenshot: one with no name; one with a German/Ukrainian name; one with group 20; one with group drt116/evo220; include spaces/tabs exactly as in file. Do not upload 650 MB until parser format is validated.
2. Inspect actual delimiters, character encoding, optional columns, decimal precision and duplicate articles. Screenshot says Windows CRLF + ANSI but ANSI is not a precise encoding.
3. Build a streaming UTF-8/Windows decoding parser, validate field boundaries and group rules, reject malformed prices/keys; produce counters and reject examples. Never read entire 650 MB into RAM.
4. Bulk-load new import run into staging/rows; create/update indexes; validate sampled prices, counts and disk space; only then set READY and switch active_import_id atomically. Failed import must not replace current dataset.
5. Handle duplicate articles deterministically after verifying real data (do not invent a supplier-selection rule).
6. Add fallback to `readWebsiteArticleSearch` ONLY after existing offer availability is known; do not use `searchResult.found` alone because existing product cards can have no sellable offers. Guard with a feature flag and test same-art/article family cases.
7. Add a search-only frontend inquiry card and protected manager lead/contact flow; validate phone, prevent spam, collect consent, avoid price in checkout.
8. Add integration tests for guest/registered/GOLD/VIP, no warehouse offers, invalid groups, missing names, missing TXT revision, concurrent import, and MAKAtron parity.
9. Dry-run on an isolated DB; backup Production before any migration or import; inspect resource/DB impact.

No deployment or DB import is authorized by this branch alone.
