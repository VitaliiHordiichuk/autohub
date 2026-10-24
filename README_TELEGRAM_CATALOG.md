# MAKA Telegram catalogue lookup (review draft)

## Scope
- Private-chat lookup by one article or by 2–20 articles separated by newline, comma or semicolon.
- Reuse `SearchService` and `ProductCardService`: canonical Mercedes A/N, exact matches, replacement paths, analogues, stock offers.
- Reuse `CustomerPricingService` and public presenter so the bot reflects registered/guest MAKA price rules.
- Present available OWN_STOCK and SUPPLIER offers separately; do not expose internal supplier identity, warehouse identity or staff price matrices.
- Detailed replacements/analogues for a **single** article. Batch replies are concise with clickable product article links.
- Keep existing /start token binding, contact verification and Telegram notifications unchanged. Existing order and VIN notifications remain managed by `TelegramNotificationService`.
- No Telegram bot token or secrets added to GitHub.

## Rollout: not enabled by this PR
The new behaviour is **off by default**:
`TELEGRAM_CATALOG_SEARCH_ENABLED=false`.

After review and tests, deployment may opt in by setting
`TELEGRAM_CATALOG_SEARCH_ENABLED=true` on the backend and restarting only the backend.
No frontend deployment, new table, extra server, AI or subscription needed.
`TELEGRAM_BOT_POLLING_ENABLED` remains the existing transport switch.

## Pricing security
Pricing identity is resolved by matching both `telegram_chat_id` and
`telegram_user_id` to exactly one **active CLIENT** user. Missing, wrong,
inactive, staff and ambiguous connections fall back to guest prices.
The bot does not accept a user-supplied MAKA ID or role.
This preserves the difference between guest and registered customer prices
and avoids staff `priceMatrix` disclosures.

## Operational limits
- Search only in private chats (no price replies in groups).
- 20 submitted articles at most; duplicates are de-duplicated after article normalization.
- Each Telegram reply contains at most five compact results.
- 3-second in-memory sender throttle, 2,500-character input limit.
- Invalid input and missing articles get clear error messages.
- A failure of one article does not stop remaining articles.
- The bot uses existing polling infrastructure (one worker). For multiple
  backend worker instances, move polling to a single dedicated worker first.
- Prices and availability are snapshots, not reservations or stock guarantees.

## Review checklist
1. Run targeted unit tests:
   `node --test src/services/TelegramCatalogFormatter.test.js src/services/TelegramCatalogService.test.js src/services/TelegramNotificationService.test.js`
2. Run `node --check` for TelegramBotService, TelegramCatalogService, TelegramCatalogFormatter.
3. Verify the existing `/start <48-hex-token>` and contact verification flow.
4. Confirm guest vs uniquely linked client pricing; different users must never
   receive another customer's price.
5. Confirm own warehouse and supplier offers, reserved/unavailable stock,
   replacement paths, analogues, and the clickable product URLs.
6. Stage on a **non-production** bot token, if available, before enabling
   the feature on the existing production token.
7. Keep the feature flag false on production until reviewed.

## Revert
Set `TELEGRAM_CATALOG_SEARCH_ENABLED=false` and restart backend to disable
catalogue replies while retaining existing Telegram account links and notifications.
