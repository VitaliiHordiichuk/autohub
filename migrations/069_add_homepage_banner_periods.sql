BEGIN;

ALTER TABLE homepage_banners
  ADD COLUMN IF NOT EXISTS starts_on DATE,
  ADD COLUMN IF NOT EXISTS ends_on DATE;

UPDATE homepage_banners
SET
  starts_on = COALESCE(starts_on, scheduled_date),
  ends_on = COALESCE(ends_on, scheduled_date)
WHERE scheduled_date IS NOT NULL;

DROP INDEX IF EXISTS homepage_banners_scheduled_date_unique;
DROP INDEX IF EXISTS homepage_banners_active_date;

ALTER TABLE homepage_banners
  DROP CONSTRAINT IF EXISTS homepage_banners_period_check;

ALTER TABLE homepage_banners
  ADD CONSTRAINT homepage_banners_period_check CHECK (
    (starts_on IS NULL AND ends_on IS NULL)
    OR
    (starts_on IS NOT NULL AND ends_on IS NOT NULL AND starts_on <= ends_on)
  );

CREATE INDEX IF NOT EXISTS homepage_banners_active_period
  ON homepage_banners(is_active, starts_on, ends_on);

INSERT INTO schema_migrations(version)
VALUES ('069_add_homepage_banner_periods')
ON CONFLICT(version) DO NOTHING;

COMMIT;
