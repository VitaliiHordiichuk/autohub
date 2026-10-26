# MAKAtron restricted staff pilot — Orders + Parts Quotes

Scope: **new orders** (notify, confirm, cancel, open admin) and **parts quotes**
(warehouse availability, true incoming unit cost, existing price groups, safe
customer offer). No VIN request workflow or analytics are added.

## Deployment boundary

- Public MAKA backend and the old Telegram bot are NOT part of this patch.
- Apply ONLY the runtime paths changed from
  `feat/mercedes-private-cost-import-2026-10-26` to
  `feat/makatron-staff-orders-quotes-2026-10-26`.
- Deploy into the existing isolated MAKAtron worker release, **not** into
  the production website backend folder.
- Confirm `git apply --check` succeeds on the precise worker source tree.
- Backup the `autohub` database before migration 117.
- Migration `117_makatron_staff_orders_quotes.sql` creates dedicated staff
  links/tokens and a durable new-order delivery cursor. Existing orders
  are marked past on first initialization, so no old order flood occurs.
- All new behavior is inactive by default: `TELEGRAM_STAFF_ENABLED=false`.
- Production activation requires explicit operator verification, and a
  separate private staff-linking operation on the worker.

## Staff activation

1. With code and migration verified, set `TELEGRAM_STAFF_ENABLED=true`
   **only in the isolated MAKAtron worker environment**.
2. Restart `makatron-bot` only, check logs and existing public catalog works.
3. Find MAKA staff `users.id` with active roles `ADMIN` or `MANAGER`:
   `SELECT u.id, r.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.is_active AND r.name IN ('ADMIN','MANAGER') ORDER BY u.id;`
4. On the MAKAtron worker checkout run
   `node --env-file=... scripts/makatron-staff-link.mjs USER_ID`
   with its configured private DB environment.
   The output is a secret 15-minute one-use Telegram deep link.
   **Do not paste the link into ChatGPT, logs, or a public channel.**
5. Staff member opens the link from their own private Telegram account and
   receives the two-button staff menu. No customer phone verification or
   old-bot linking is reused.
6. A manager may type an article, or use `/price A1679068510` to get
   real-time offers, incoming cost and group prices. Price group buttons send
   a separate cost-free customer-ready text to the manager for forwarding.
7. New orders are notified via the isolated worker's Telegram token; the
   notification includes item list, amount, recipient and delivery.
   Confirm/cancel callbacks ALWAYS recheck role and require a second tap.
   Status transitions call existing OrderConfirmationService /
   OrderCancellationService, preserving stock and audit log behavior.

## Security and operational notes

- Each staff request verifies *both* private chat ID and sending Telegram
  user ID against a unique, separately linked active staff MAKA user.
- Revoking staff access: `DELETE FROM makatron_staff_links WHERE user_id=$1;`
  or deactivate/change the staff role in MAKA. Access checks take effect
  immediately; previous Telegram messages cannot be recalled.
- `TELEGRAM_STAFF_ENABLED=false` instantly disables incoming staff features
  on next worker restart. No need to alter pricing/storage tables.
- Private incoming prices are fetched only by the staff quote service,
  never by the safe customer quote builder. The bot does not expose them
  to public catalog users or guest chat IDs.
- Notification progress is stored per order + staff account. If a Telegram
  send fails, the unsent order remains eligible for retry. On startup the
  cursor records max pre-existing order ID.
- No changes are made to the separate, earlier VIN notification service.
  No VIN features are presented in the MAKAtron staff menu.

## Test command

`node --test src/services/MakatronStaffBotService.test.js`

For database integration, apply migration 117 on a disposable restored copy of
the MAKA database and use:

`DB_NAME=autohub_makatron_staff_stage_<timestamp> NODE_ENV=test node --env-file=<private-worker-env> scripts/test-makatron-staff-staging.mjs`

The script refuses any non-staging DB name, performs only SELECTs, checks real
Mercedes cost and client-safe quotes, and sends no Telegram messages.

GitHub Actions workflow: `.github/workflows/makatron-staff-checks.yml`.
