# MAKA unified website + Telegram search (staging release plan)

## Single source of truth
- Both Telegram catalog search and Telegram inline checkout call POST `/api/search/telegram-shared` on the currently running MAKA website backend, using one common `readWebsiteArticleSearch` service also called by `/api/search/product`.
- The website's `SearchService`, `MercedesFamilyOfferService`, `OfferService`, and replacements decide the actual catalogue products and offers. No Telegram-specific suffix matching runs when `MAKATRON_SHARED_SITE_SEARCH_ENABLED=true`.
- The staff bot calls the same endpoint with role=staff; only the verified staff mode receives the extra `staffPrices` map. The website backend computes VIP/retail using `CustomerPricingService` and current VIP group settings. Purchasing cost is restricted to warehouse ID 1.
- Customer-ready one-line quotations call POST `/api/search/telegram-quote` and contain *only* article and selected price. Supplier retail buttons remain disallowed.
- Telegram-specific presentation, message length limits, quantity controls and checkout transaction validation remain separate; they are not catalogue-matching rules.

## Credential boundary
- Both internal endpoints require an independently provisioned random `MAKATRON_SEARCH_BRIDGE_SECRET` of at least 32 UTF-8 bytes in **both** backend and isolated Telegram worker. Never commit the value or send it in chat.
- The worker connects via `MAKATRON_SEARCH_BRIDGE_URL=http://127.0.0.1:4000`; only loopback HTTP is accepted by the worker. The secret is sent in a private header, never as a query string.
- Staff / CLIENT identity is checked on each request against active users/roles by the backend, and Telegram's strict chat+sender verification remains mandatory in the worker. Guests never receive cost data or another customer's discount.

## Safe activation sequence
1. Do **not** deploy the combined feature branch to the website backend. It includes Telegram worker code that is intentionally isolated.
2. First validate and deploy the **backend-only** branch `feat/maka-unified-search-backend-2026-10-27`, based on `main`, after a backend backup/release check. The public `/api/search/product` response contract must remain unchanged.
3. Configure matching secret in backend and Telegram worker environment privately. Test 403 with an invalid key and 200/404 with an authorized internal request. Confirm staff cost is absent from guest/client responses.
4. Apply **only the Telegram runtime paths** from `feat/maka-unified-search-site-telegram-2026-10-27` to the dedicated MAKAtron checkout. Do not copy its controller/routes into production backend.
5. Keep `MAKATRON_SHARED_SITE_SEARCH_ENABLED=false` until backend and worker contract tests pass. Enable on the isolated worker and restart `makatron-bot` only.
6. Compare base, SAME and VARIANT numbers (e.g., `A2966808206`, `A1673200503`, `A167320050380`), replacements, guest/client pricing, staff cost and VIP, supplier VIP-only button, and one-line client-ready quote.
7. Verify order checkout revalidates stock and price before committing, and the site remains available. Change website search logic once; subsequent Telegram searches should reflect the result *without restarting Telegram*.

## Rollback
- Switch `MAKATRON_SHARED_SITE_SEARCH_ENABLED=false` and restart only `makatron-bot`; the existing Telegram search path remains as a temporary rollback until the new integration is validated.
- Never log or print the private shared secret. No database migration is introduced by this integration.
- Do not remove the legacy code until live acceptance is complete.
