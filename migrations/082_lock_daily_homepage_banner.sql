BEGIN;

CREATE TABLE IF NOT EXISTS homepage_banner_daily_selections (
  display_date DATE PRIMARY KEY,
  banner_id BIGINT REFERENCES homepage_banners(id) ON DELETE SET NULL,
  selection_type VARCHAR(16) NOT NULL
    CHECK (selection_type IN ('SCHEDULED', 'ROTATION', 'EMPTY')),
  rotation_position BIGINT,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS homepage_banner_daily_rotation
  ON homepage_banner_daily_selections(display_date DESC)
  WHERE selection_type = 'ROTATION' AND rotation_position IS NOT NULL;

GRANT SELECT, INSERT ON homepage_banner_daily_selections TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('082_lock_daily_homepage_banner')
ON CONFLICT(version) DO NOTHING;

COMMIT;
