# MAKA SEO Phase 1 — 2026-10-08

## Scope and evidence

Read-only production HTTP audit preceded changes: sitemap index and every referenced shard, all localized catalog trees, SEO sitemap API, robots.txt, and 49 representative HTML responses. No production DB access, deployment, environment changes or membership edits. This is a code + public HTTP audit, not Search Console validation or a full crawl of every localized product URL.

Raw evidence retained locally in `/private/tmp/maka-seophase1-http/`, including `report.json`; pre-change report is `/private/tmp/maka-seophase1-prechange-audit.md`. The historical URL map below uses the accepted 2026-10-04 catalog snapshot and authenticated customer-membership artifact: its per-category counts are historical, not current production counts.

## Findings and changes

| Priority | Evidence before change | Safe change |
| --- | --- | --- |
| High | Secondary sitemap: 1,326 URLs / 442 unavailable products, while their pages are noindex. Primary also includes A465320150228 although its current page is noindex. | Sitemap availability now includes effective positive guest price and reservation-aware free stock. Frontend emits only `isAvailable === true` products. Product no-offer `noindex,follow` remains unchanged. |
| High | Product SEO category still came from technical EPC: A2036703401 and A166670100164 link to `mb-group-67` (404); A2711800109 links to `mb-group-18` (404). | Only the public category lookup uses approved primary customer membership when the existing public feature flag is enabled. Legacy lookup remains the fallback with flag off. Unresolved products get no invented category. Visible category links and category-fallback breadcrumbs consume this result; existing preference for brand breadcrumbs remains unchanged. |
| Medium | Category metadata universally claims original/genuine Mercedes-Benz, including virtual Other. | Localized, truthful category title/description plus section-specific selection guidance, actual category name/count and VIN/help links. H1, URLs, canonical, hreflang, pagination and filter indexing semantics retained. |
| Medium | Retired technical system URLs return 404 without equivalent public routes. | Four reviewed system replacements only: `mb-group-42/43` to `brakes`, `mb-group-46` to `steering`, `mb-group-49` to `exhaust`. Mixed groups remain unmapped. |

### Sitemap measurements before changes

| Shard | URLs | Uncompressed bytes | HTTP |
| --- | ---: | ---: | ---: |
| core | 549 | 266,858 | 200 |
| products-primary | 18,285 | 9,450,995 | 200 |
| products-secondary | 1,326 | 680,498 | 200 |

All XML parsed; zero duplicate URLs across shards; zero `/processed/` image URLs; Other and technical EPC categories absent from core. All shards below 50,000 URL / 50 MB limits. API: 6,537 active products, previous availability 6,095 true / 442 false, 515 products expose safe image URLs. No normalized duplicate articles in this export. These are product counts, not product_images row counts or proof that every remote image is reachable.

New code removes the known 442 unavailable products and any additional price/reservation-ineligible products. Exact post-fix production eligible count needs a future authorized deployment/read-only measurement; it was not invented from historical snapshots. An empty secondary shard is removed from the index and its existing handler returns 404, rather than successful empty XML. Product URLs themselves are retained. Chunking, CLEAN image selection, lastmod and language alternates remain unchanged.

### HTTP, metadata and structured data

Sample `/uk`, `/ru`, `/en`, category, brand, product and informational pages have correct initial document language and clean canonical plus uk/ru/en/x-default. Category `page=1` canonical is clean, `page=2` self canonical; invalid, repeated and out-of-range page is a real HTTP 404 with no canonical/hreflang. Filtered pages and Other are noindex. Tracking-query variants have clean canonical; they were not mass-redirected. Missing products have real 404. No from/fromLabel product hrefs appeared in category samples.

Product samples included windshields with real images/offers, A0001800109 and A1668200514 without eligible image schema, unavailable A465320150228/B66959622/HU718/5X and variant A271180010964. Product schema is intentionally gated by real CLEAN/original image + positive public offer; no-photo products were not mass-noindexed. Product/WebPage/BreadcrumbList JSON-LD is server-rendered. Category ItemList/BreadcrumbList and offer currency/price are present in eligible samples. Product title contains article; H1 uses localized name with article displayed separately. Manufacturer MANN remains MANN; product original wording remains conditional on actual productType. No descriptions/specifications/compatibility/images were fabricated; Product/Offer/Merchant code was not edited.

Remaining photo coverage is a data task: collect real images by actual demand, availability and sales. Rich Results Test and GSC Merchant/product enhancement reports are still needed to establish Google's acceptance, not merely JSON syntax validity.

## Actual legacy dependencies and load

- PublicCatalogService branches on CUSTOMER_TAXONOMY_PUBLIC_ENABLED before executing the legacy/customer implementation. It does not load both trees. Keep the legacy implementation for reversible rollout.
- The unnecessary public EPC category query was in PublicSeoService.getProduct. It is replaced one-for-one, not supplemented with an extra classification query.
- Technical EPC joins used by product image placeholder selection, Google Merchant technical category mapping, imports, detector and technical triggers remain necessary. They were not removed. No taxonomy classification runs on a public request.
- Catalog lists batch 24 products and batch offers; no per-product HTTP requests were added. Guest metadata/page share the same fetch options and Next request memoization; client refresh carries live session/cart context and remains intentional.
- Startup schedulers found: email imports, translations, Telegram, image processing/recovery, retention. No extra customer-public-taxonomy background scheduler was found. No scheduler was removed. Production PM2/pg_stat_statements inventory was not performed.
- Redirect lookup runs only for locale catalog `mb-*` requests, never clean catalog/product/search routes. Backend queries only the reviewed target category; no product scan. Flag off or unmapped slug is a null decision without a target query.
- Sitemap stock eligibility adds reservation aggregation matching existing public offer rules. Test DB validates semantics; production EXPLAIN, p95 load and stock_reservations index verification remain a deployment follow-up. This audit does not claim a measured production SQL speedup.
- Sitemap retains its existing 300-second data/HTTP caching and stale-while-revalidate behavior. Therefore a stock change can temporarily lag sitemap refresh, while product robots use fresh data. Cache redesign/invalidation was not silently included. Largest live shard took roughly 2.5 seconds and secondary 3.2 seconds in this single client-side sample; these are neither server TTFB isolation nor Core Web Vitals.

## Redirect contract and rollback

New public read-only endpoint: `GET /api/catalog/legacy-redirect/:slug`, `Cache-Control: no-store`.

- Flag off or unreviewed slug: `200 {success:true,redirect:null}`.
- Flag on and existing ACTIVE root: `200 {success:true,redirect:{slug:"brakes",status:301}}` (or steering/exhaust).
- Actual backend failure: 503, never a fake no-match.

Frontend Next 16 Proxy asks this endpoint only for supported-locale `mb-*` catalog requests, validates the target, and returns real 301 preserving locale and query. No independent frontend taxonomy flag. Error yields 503 so a backend outage cannot masquerade as permanent removal. The redirect is no-store to allow feature-flag rollback; external search engines may still remember permanent moves.

Deploy backend first, frontend second only after separate authorization. The new frontend needs the new endpoint; against an old backend these legacy requests fail safely with 503. Setting the existing backend public flag false restores legacy categories/product category source and disables redirects. No flag/environment was changed in this task. Existing stable customer URLs do not redirect. Four system redirects are not a promise of identical historical inventory. Pagination bounds are validated by the destination; no out-of-range page is fabricated.

## Validation

- Isolated PostgreSQL targeted tests: 4/4 (new SEO consistency cases plus existing cross-channel offer selection).
- Full backend suite: 560/560, isolated `autohub_test`; no production data changes.
- Frontend unit suite: 124/124; production HTTP suite: 17/17.
- TypeScript, production frontend build, Node syntax and git diff --check pass.
- ESLint: zero errors, two pre-existing unrelated warnings (AdminHeaderTools.canManageCustomerPricing and contacts.STORE_HOURS).
- Fresh Chrome local production build at 390/1440 px: help navigation, back/forward, focus and idle passed; zero console errors/warnings/failed responses, one html/body, no horizontal overflow. Browser API/image data was explicitly mocked; this is not an authenticated production checkout test.
- All 177 current category names (176 real + Other) yield 177 distinct titles and descriptions in each of uk/ru/en. The two Wheels names are disambiguated in metadata using the accessory parent, without renaming the category/H1.

## Follow-up requiring evidence or access

GSC: indexed legacy URLs and traffic before expanding redirects, Google-selected canonicals, excluded/noindex sitemap URLs after resubmission, Merchant/Product rich-result coverage, search demand for real photo work and Core Web Vitals. Remaining mixed URL mappings require current product-level membership comparison and reviewed intent, not majority voting. Technical query variants/normalized aliases were sampled, not exhaustively crawled. No deletion of EPC data or fallback code is justified by this audit.

References: [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [Google redirects](https://developers.google.com/search/docs/crawling-indexing/301-redirects). Sitemap should publish canonical URLs intended for indexing; a redirect should have a relevant destination.

## Historical public URL map

Paths below are relative to `/{uk|ru|en}/catalog/`. `KEEP` means the slug remains usable in the new tree (inventory can change). `REVIEW` means no redirect is implemented; mixed or insufficiently confirmed destinations need further review. The four `301` entries are the only automatic mappings. Historical root distributions include unresolved products, which are never used to force an assignment.

| Legacy slug | Decision | Target | Historical root distribution |
| --- | --- | --- | --- |
| accessories | KEEP | — | accessories:315, UNCLASSIFIED:100 |
| mb-accessories-b | REVIEW | — | accessories:315, UNCLASSIFIED:2 |
| mb-accessories-floor-mats | REVIEW | — | accessories:55 |
| mb-accessories-luggage | REVIEW | — | accessories:24 |
| mb-accessories-wheels | REVIEW | — | accessories:11 |
| mb-accessories-interior | REVIEW | — | accessories:1 |
| mb-accessories-exterior | REVIEW | — | accessories:14 |
| mb-accessories-multimedia | REVIEW | — | accessories:5 |
| mb-accessories-collection | REVIEW | — | accessories:205 |
| mb-accessories-other | REVIEW | — | UNCLASSIFIED:2 |
| mb-group-58 | REVIEW | — | UNCLASSIFIED:44, accessories:1 |
| mb-group-84 | REVIEW | — | accessories:1, UNCLASSIFIED:3 |
| mb-group-89 | REVIEW | — | UNCLASSIFIED:51, accessories:4 |
| engine | KEEP | — | engine:356, UNCLASSIFIED:130, filters-maintenance:150, exhaust:3 |
| mb-group-01 | REVIEW | — | engine:117, UNCLASSIFIED:7, filters-maintenance:1 |
| mb-group-03 | REVIEW | — | engine:14 |
| mb-group-05 | REVIEW | — | engine:43 |
| mb-group-09 | REVIEW | — | engine:78, filters-maintenance:93, UNCLASSIFIED:1 |
| mb-group-14 | REVIEW | — | exhaust:3, UNCLASSIFIED:109, engine:4 |
| mb-group-18 | REVIEW | — | filters-maintenance:56, engine:34, UNCLASSIFIED:1 |
| mb-group-22 | REVIEW | — | engine:4, UNCLASSIFIED:1 |
| mb-group-23 | REVIEW | — | engine:16, UNCLASSIFIED:1 |
| mb-group-24 | REVIEW | — | engine:46, UNCLASSIFIED:10 |
| fuel-system | KEEP | — | exhaust:8, fuel-system:107, UNCLASSIFIED:31, filters-maintenance:6 |
| mb-group-07 | REVIEW | — | fuel-system:61, UNCLASSIFIED:27 |
| mb-group-47 | REVIEW | — | exhaust:8, fuel-system:46, UNCLASSIFIED:4, filters-maintenance:6 |
| cooling | KEEP | — | cooling:164, UNCLASSIFIED:8, climate:5, engine:52, transmission-drivetrain:2 |
| mb-group-20 | REVIEW | — | cooling:79, UNCLASSIFIED:4, engine:52 |
| mb-group-50 | REVIEW | — | cooling:85, climate:5, UNCLASSIFIED:4, transmission-drivetrain:2 |
| transmission | REVIEW | — | transmission-drivetrain:101, UNCLASSIFIED:1 |
| mb-group-25 | REVIEW | — | transmission-drivetrain:5 |
| mb-group-26 | REVIEW | — | transmission-drivetrain:12 |
| mb-group-27 | REVIEW | — | transmission-drivetrain:61, UNCLASSIFIED:1 |
| mb-group-28 | REVIEW | — | transmission-drivetrain:4 |
| mb-group-37 | REVIEW | — | transmission-drivetrain:19 |
| brakes | KEEP | — | UNCLASSIFIED:114, brakes:289 |
| mb-group-42 | 301 | brakes | UNCLASSIFIED:90, brakes:286 |
| mb-group-43 | 301 | brakes | UNCLASSIFIED:24, brakes:3 |
| suspension | KEEP | — | UNCLASSIFIED:103, suspension:428, fasteners-seals-standard-parts:26, steering:20, filters-maintenance:4 |
| mb-group-32 | REVIEW | — | suspension:269, fasteners-seals-standard-parts:3, UNCLASSIFIED:3, filters-maintenance:4 |
| mb-group-33 | REVIEW | — | suspension:109, UNCLASSIFIED:56, fasteners-seals-standard-parts:11, steering:17 |
| mb-group-35 | REVIEW | — | UNCLASSIFIED:44, suspension:50, fasteners-seals-standard-parts:12, steering:3 |
| steering | KEEP | — | steering:62, UNCLASSIFIED:2 |
| mb-group-46 | 301 | steering | steering:62, UNCLASSIFIED:2 |
| drivetrain | REVIEW | — | transmission-drivetrain:17 |
| mb-group-36 | REVIEW | — | transmission-drivetrain:2 |
| mb-group-41 | REVIEW | — | transmission-drivetrain:15 |
| wheels | KEEP | — | wheels:42, UNCLASSIFIED:1 |
| mb-group-40 | REVIEW | — | wheels:42, UNCLASSIFIED:1 |
| electrical | REVIEW | — | electrical-electronics-lighting:689, UNCLASSIFIED:298, brakes:8, filters-maintenance:93, fasteners-seals-standard-parts:66, exhaust:12, wheels:9 |
| mb-group-15 | REVIEW | — | UNCLASSIFIED:30, electrical-electronics-lighting:22, filters-maintenance:37, exhaust:1, fasteners-seals-standard-parts:6 |
| mb-group-44 | REVIEW | — | UNCLASSIFIED:8, brakes:1, electrical-electronics-lighting:9 |
| mb-group-54 | REVIEW | — | electrical-electronics-lighting:324, brakes:6, UNCLASSIFIED:35 |
| mb-group-82 | REVIEW | — | electrical-electronics-lighting:170, UNCLASSIFIED:18, filters-maintenance:53 |
| mb-group-87 | REVIEW | — | electrical-electronics-lighting:8, UNCLASSIFIED:8 |
| mb-group-90 | REVIEW | — | UNCLASSIFIED:55, electrical-electronics-lighting:139, exhaust:11, brakes:1, wheels:9, filters-maintenance:3 |
| mb-group-98 | REVIEW | — | UNCLASSIFIED:144, electrical-electronics-lighting:17, fasteners-seals-standard-parts:60 |
| climate | KEEP | — | filters-maintenance:67, climate:37, UNCLASSIFIED:14 |
| mb-group-83 | REVIEW | — | filters-maintenance:67, climate:37, UNCLASSIFIED:14 |
| exhaust | KEEP | — | exhaust:53 |
| mb-group-49 | 301 | exhaust | exhaust:53 |
| body | REVIEW | — | body-glass:550, accessories:13, UNCLASSIFIED:218, exhaust:1 |
| mb-group-52 | REVIEW | — | body-glass:25, UNCLASSIFIED:1 |
| mb-group-61 | REVIEW | — | body-glass:7 |
| mb-group-62 | REVIEW | — | body-glass:25, UNCLASSIFIED:5 |
| mb-group-63 | REVIEW | — | body-glass:9 |
| mb-group-65 | REVIEW | — | body-glass:1, UNCLASSIFIED:2 |
| mb-group-67 | REVIEW | — | body-glass:56, UNCLASSIFIED:3 |
| mb-group-69 | REVIEW | — | UNCLASSIFIED:88, body-glass:33 |
| mb-group-72 | REVIEW | — | body-glass:35, UNCLASSIFIED:22 |
| mb-group-73 | REVIEW | — | body-glass:18, UNCLASSIFIED:15 |
| mb-group-74 | REVIEW | — | body-glass:8 |
| mb-group-75 | REVIEW | — | body-glass:15 |
| mb-group-76 | REVIEW | — | body-glass:38, UNCLASSIFIED:7 |
| mb-group-77 | REVIEW | — | UNCLASSIFIED:1 |
| mb-group-78 | REVIEW | — | body-glass:5, UNCLASSIFIED:3 |
| mb-group-79 | REVIEW | — | body-glass:3 |
| mb-group-80 | REVIEW | — | UNCLASSIFIED:8 |
| mb-group-81 | REVIEW | — | accessories:13, UNCLASSIFIED:56, body-glass:32 |
| mb-group-85 | REVIEW | — | body-glass:3 |
| mb-group-88 | REVIEW | — | body-glass:237, UNCLASSIFIED:7, exhaust:1 |
| interior | REVIEW | — | accessories:50, interior-safety:193, UNCLASSIFIED:26 |
| mb-group-68 | REVIEW | — | accessories:48, interior-safety:69, UNCLASSIFIED:7 |
| mb-group-86 | REVIEW | — | interior-safety:70, accessories:2, UNCLASSIFIED:4 |
| mb-group-91 | REVIEW | — | interior-safety:39, UNCLASSIFIED:1 |
| mb-group-92 | REVIEW | — | interior-safety:12 |
| mb-group-93 | REVIEW | — | interior-safety:3 |
| mb-group-97 | REVIEW | — | UNCLASSIFIED:14 |
| controls | REVIEW | — | UNCLASSIFIED:3, interior-safety:3 |
| mb-group-29 | REVIEW | — | interior-safety:1, UNCLASSIFIED:1 |
| mb-group-30 | REVIEW | — | interior-safety:2 |
| mb-group-31 | REVIEW | — | UNCLASSIFIED:2 |
| fasteners | REVIEW | — | fasteners-seals-standard-parts:1039, UNCLASSIFIED:7, wheels:1 |
| mb-group-99 | REVIEW | — | fasteners-seals-standard-parts:1039, UNCLASSIFIED:7, wheels:1 |
| other | KEEP | — | fasteners-seals-standard-parts:368, UNCLASSIFIED:133 |
