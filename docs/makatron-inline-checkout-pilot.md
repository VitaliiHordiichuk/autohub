# MAKAtron — Telegram checkout pilot

## Scope

- One or up to 20 article numbers have the same editable Telegram message.
- Displays the selected offer's **actual public available quantity** and the viewer's price.
- `−`, `+`, remove, rotate supplier/MAKA offers, add another article.
- Confirm items → choose generic pickup (no address or internal warehouse) or Nova Poshta branch/locker → recipient → final order review → place order → manager-contact thank-you.
- Default Ukrainian, optional English.
- Existing checkout remains the source of truth: COMMIT_ON_SUBMIT stock deduction, supplier order reservations,
  price/quantity revalidation, status, staff notifications and idempotency.
- Guest checkout available; uniquely linked and active CLIENT retains private pricing and customer association
  through an internal-only trusted customer context, while a temporary guest cart **never changes the client's
  website cart**.
- NO online capture/payment in this iteration. Order is registered for subsequent payment / fulfillment.
- The list is a draft, NOT an order until the final confirmation is pressed.

## Production safety

All new bot behavior is disabled unless `TELEGRAM_INLINE_CHECKOUT_ENABLED=true`.
For a private pilot also set `TELEGRAM_INLINE_CHECKOUT_TEST_CHAT_ID=<one Telegram private chat ID>`;
all other users retain the old bot response and cannot access the new callbacks.
Do **not** add these flags to the live HTTP backend.

The polling worker must use the new @MAKA_com_ua_bot token only. Never enable polling in the
HTTP backend. Only the dedicated PM2 worker needs the new feature branch.

## Before enabling any pilot

1. Back up the DB and check that migration 110 is already present.
2. Apply additive migration `migrations/111_telegram_order_drafts.sql` (includes grants to `autohub_app`).
3. Verify the dedicated worker has `NOVA_POSHTA_API_KEY` (do not print its value).
   If absent, NP delivery must not be tested until securely configured. Pickup still works.
4. Telegram pickup is manager-arranged. Never expose or require an internal warehouse ID or address; customer name and phone are required. No public pickup point setup or migration 112 is needed for the **Telegram-only worker**.
5. Check the feature branch against the deployed site's active checkout / inventory migrations,
   especially 105 COMMIT_ON_SUBMIT. Site and polling worker should share a compatible DB schema.
6. Use your own private Telegram chat ID in the pilot flag. Do not use a real customer chat.
7. Run the focused tests and a test-database checkout through to NEW order status before using
   production inventory. Test normal and linked-client pricing, stock changes, callbacks repeated
   after a crash, supplier + own mixed basket, invalid phone, invalid NP city/point.

## Read-only smoke before migration

```bash
cd ~/maka-telegram-makatron
git fetch origin feat/makatron-inline-checkout-2026-10-25
git worktree add --detach ~/maka-telegram-checkout origin/feat/makatron-inline-checkout-2026-10-25
cd ~/maka-telegram-checkout
npm ci --ignore-scripts
node --test src/services/TelegramOrderService.test.js src/services/TelegramCatalogService.test.js src/services/CheckoutSelection.test.js
node --check src/services/TelegramBotService.js
node --check src/services/TelegramOrderService.js
git rev-parse --short HEAD
```

Do not copy `.env`, apply SQL, switch active PM2 script path, set flags or restart the bot until
database and checkout smoke checks are reviewed. Order confirmation on a live DB makes real orders
and may deduct stock.

## Important known limits for first pilot

- One chat/session (latest part list replaces the previous draft).
- Up to 20 parts; a Telegram keyboard is limited so larger lists require pagination in a later version.
- Nova Poshta: city and branch/locker lookup use existing MAKA NovaPoshtaService; no courier delivery yet.
- Recipient enters `First name; Last name; +380XXXXXXXXX` in one message.
- Generic Telegram pickup has no warehouse/address selection and stores `pickupWarehouseId: null`. Manager contacts the customer after successful order submission. Nova Poshta displays up to 8 city/branch results; search can be refined.
- Backend API of the live site is unchanged until a separately reviewed backend rollout.
- No fiscal receipt or Telegram payment capture is issued by this pilot.
