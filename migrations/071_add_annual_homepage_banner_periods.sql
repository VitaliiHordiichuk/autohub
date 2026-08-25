BEGIN;

ALTER TABLE homepage_banners
  ADD COLUMN IF NOT EXISTS repeats_annually BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE homepage_banners
  DROP CONSTRAINT IF EXISTS homepage_banners_period_check;

ALTER TABLE homepage_banners
  ADD CONSTRAINT homepage_banners_period_check CHECK (
    (starts_on IS NULL AND ends_on IS NULL AND repeats_annually = FALSE)
    OR
    (
      starts_on IS NOT NULL
      AND ends_on IS NOT NULL
      AND (repeats_annually = TRUE OR starts_on <= ends_on)
    )
  );

CREATE INDEX IF NOT EXISTS homepage_banners_annual_period
  ON homepage_banners(is_active, repeats_annually, starts_on, ends_on);

INSERT INTO schema_migrations(version)
VALUES ('071_add_annual_homepage_banner_periods')
ON CONFLICT(version) DO NOTHING;

COMMIT;
