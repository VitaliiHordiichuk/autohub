BEGIN;

ALTER TABLE homepage_banners
  ADD COLUMN IF NOT EXISTS show_daily_fact_label BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO schema_migrations(version)
VALUES ('070_add_homepage_banner_label_setting')
ON CONFLICT(version) DO NOTHING;

COMMIT;
