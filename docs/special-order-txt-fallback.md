# MAKA: TXT-only special-order fallback (work in progress)

## Agreed product behavior
1. Search the existing MAKA warehouse and partners first using the unified website search.
2. If ANY eligible, available on-hand/partner offer exists, do not query special-order TXT.
3. Otherwise look up the **second article** from the TXT by normalized exact article, without creating products, catalog pages, Merchant entries or sitemaps. If that second article ends in **W** (case-insensitive), exclude the row even if it starts with W; if it starts with **W** but does not end in W, treat it as a tool and price it normally if its discount group is approved.
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
- Article filter: `src/services/SpecialOrderArticlePolicy.js` (terminal W excluded, W-prefix tool allowed).
- Fixed-width sample parser: `src/services/SpecialOrderTxtParser.js` (decoded Unicode field positions, not split-on-whitespace).
- Read-only streaming file preview: `node scripts/preview-special-order-txt.mjs --file PATH [--encoding utf-8|windows-1251]`. Reads the real file incrementally, reports accepted/rejected counts and tool-code statistics, **never writes to DB**. This is NOT yet a database importer.
- No changes to existing search endpoints or frontend; feature is **NOT LIVE**.

## Next safe engineering steps
1. Raw 32-line user TXT sample received and inspected. All lines are fixed-width 344 decoded characters; fields: second article [21,41), localized name [72,102), discount slots [102,126), retail UAH ex VAT [196,215). The samples include missing first group, names, drt116/evo220 codes. In a separate exploratory sample check, 23 / 32 lines matched approved groups; 9 were excluded for unapproved groups. No trailing-W / W-prefix sample exists yet, so those cases are tested synthetically. Validate full 650 MB file is the same record layout before import.
2. Inspect actual delimiters, character encoding, optional columns, decimal precision and duplicate articles. Screenshot says Windows CRLF + ANSI but ANSI is not a precise encoding.
3. Build a streaming UTF-8/Windows decoding parser, validate field boundaries and group rules, reject malformed prices/keys; produce counters and reject examples. Never read entire 650 MB into RAM.
4. Bulk-load new import run into staging/rows; create/update indexes; validate sampled prices, counts and disk space; only then set READY and switch active_import_id atomically. Failed import must not replace current dataset.
5. Handle duplicate articles deterministically after verifying real data (do not invent a supplier-selection rule).
6. Add fallback to `readWebsiteArticleSearch` ONLY after existing offer availability is known; do not use `searchResult.found` alone because existing product cards can have no sellable offers. Guard with a feature flag and test same-art/article family cases.
7. Add a search-only frontend inquiry card and protected manager lead/contact flow; validate phone, prevent spam, collect consent, avoid price in checkout.
8. Add integration tests for guest/registered/GOLD/VIP, no warehouse offers, invalid groups, missing names, missing TXT revision, concurrent import, and MAKAtron parity.
9. Dry-run on an isolated DB; backup Production before any migration or import; inspect resource/DB impact.

No deployment or DB import is authorized by this branch alone.

## Full-source inspection (2026-11-05, verified VPS output)
- Uploaded TXT: `/home/ubuntu/maka-special-order/incoming/special_order_full.txt` (657,912,080 bytes, 1,901,480 rows).
- Full read-only Windows-1251 streaming preview results:
  - accepted: **1,543,399** source rows;
  - rejected: **358,081**;
  - `DISCOUNT_GROUP_EXCLUDED`: **355,366**;
  - `INVALID_OR_TRAILING_W_ARTICLE`: **2,715**;
  - eligible tool rows starting with `W`: **6,976**;
  - no additional rejection reasons in this run.
- **These are source rows, not distinct articles.** No deterministic duplicate-price rule has been approved.
- `scripts/audit-special-order-duplicates.mjs` analyzes normalized-article duplicates using external GNU sort (`--buffer-size=64M --parallel=1`), keeping RAM bounded. The temporary TSV and sort data are written into a private folder under `--tmp-dir` and removed afterward.
- Example read-only diagnostic command:
```bash
node scripts/audit-special-order-duplicates.mjs \
  --file /home/ubuntu/maka-special-order/incoming/special_order_full.txt \
  --encoding windows-1251 \
  --tmp-dir /home/ubuntu/maka-special-order
```
- Inspect `duplicateAudit.uniqueArticles`, `articlesWithMultipleRows`, `articlesWithDifferentPrices`, `articlesWithDifferentGroups`, `articlesWithDifferentNames`, and `pricingConflicts` before writing a final import/lookup selection policy.
- This tool does **not** access PostgreSQL, deploy code, activate a feature flag, or select any selling price.

## Full-source duplicate audit: 2026-11-05 (VPS-verified)
- 1,543,399 accepted rows = **1,543,392 normalized unique articles**.
- Only **7** articles repeat (each exactly twice); 7 extra rows.
- **6** articles have different source prices; **0** differ in discount group; 2 also differ in names.
- 1 article repeats with entirely identical terms.
- Source record widths: zero mismatches. All 17 targeted audit/parser/pricing tests passed.
- Price-conflict articles requiring quarantine, **not a minimum-price rule**:
  - `A22268027293E19`
  - `C93401212122902`
  - `QALES3004CASCOCLI`
  - `QALES90418902`
  - `QALES90418903`
  - `QSICHERBOXXLBAT13`
- Identical duplicate: `QALES9150103`.
- Therefore **1,543,386** unique articles have unambiguous terms under the current source snapshot.
- `SpecialOrderLookupService` has a SQL `NOT EXISTS` guard against any article whose duplicate price, discount group or nonblank normalized name differs. Identical duplicates collapse to one search-only inquiry result. No arbitrary lowest-price selection.
- Draft staging service `SpecialOrderStageImportService.js` and CLI `scripts/stage-special-order-txt.mjs` now write only to an explicit local test/preview database, enforce an exact source SHA-256, expected row counts and price-conflict count, and never set `special_order_sources.active_import_id`. **Not yet executed on PostgreSQL.**
- Confirmed source SHA-256 from previous Mac/VPS checksum: `1458b65df43b28eb072e2e91ac7676ff1bca1dadcb8dc124f0b943e40bc821b3`.
- Next: run stage importer unit tests, create isolated disposable database and apply migration 125 to it only, then test full 1.54m-row stage. **Do not apply migration, import, or activate on production yet.**
