BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- Extend the existing 30-day page-view rows; no accounts, IPs or raw URLs.
-- Earlier events deliberately remain unknown instead of inventing history.
ALTER TABLE site_page_views
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(8) NOT NULL DEFAULT 'unknown'
    CHECK (device_type IN ('phone','tablet','desktop','unknown')),
  ADD COLUMN IF NOT EXISTS page_path VARCHAR(300),
  ADD COLUMN IF NOT EXISTS page_article VARCHAR(64)
    CHECK (page_article IS NULL OR page_article ~ '^[A-Z0-9]{3,64}$');

INSERT INTO schema_migrations(version, executed_at)
VALUES ('135_site_visit_journal', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
ON CONFLICT(version) DO NOTHING;
COMMIT;
