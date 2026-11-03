BEGIN;

-- Selection rows must be invalidated atomically with banner changes.
GRANT DELETE ON homepage_banner_daily_selections TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('124_allow_homepage_banner_selection_refresh')
ON CONFLICT(version) DO NOTHING;

COMMIT;
