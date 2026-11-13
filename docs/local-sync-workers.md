# Background worker ownership

The latest-only importer remains `src/scripts/maka-latest-email-price-worker.mjs` (`--serve`, `--once`, or `--dry-run`). Its source is the verified PR19 implementation; it only accepts the configured latest owner (default). Do not start it as part of a build or test.

`MAKA_EMAIL_IMPORT_OWNER=latest` is the default. The legacy scheduler now requires **both** `MAKA_EMAIL_IMPORT_OWNER=legacy` and `EMAIL_IMPORT_SCHEDULER_ENABLED=true`. An old enabled flag alone cannot start it. Set the same owner in API and dedicated worker environments. Both import paths retain the same PostgreSQL advisory lock as a second concurrency guard.

Existing API retention maintenance remains the default (`DATA_RETENTION_OWNER=api`). To run the separate retained launcher `src/scripts/maka-data-retention-worker.mjs`, set `DATA_RETENTION_OWNER=dedicated` in both API and worker environments. This removes retention from API startup while preserving it in the dedicated worker. The standalone launcher loads local configuration (or `MAKA_RETENTION_ENV_FILE`), imports only DataRetentionScheduler, and starts neither EMAIL nor the HTTP server or bot. DATA_RETENTION_ENABLED remains the API emergency gate. No environment files are included in Git.

The VPS-only migration 124 grants the same DELETE permission already provided by tracked migration 131. It is deliberately not copied as a second migration. Neither was applied during local synchronization.

The VPS server outbox startup is deliberately not copied: PR19 already contains the separately gated `maka-txt-inquiry-telegram-worker-v2.mjs` launcher. Starting another outbox in the API would add a second owner. The other 11 shared VPS differences remove PR fixes (public pickup privacy, Telegram language/identity, linked-customer checkout pricing, banner concurrency tests); the PR implementations are retained.

These are local source changes only; deployment and runtime configuration are separate operations and have not been performed.
