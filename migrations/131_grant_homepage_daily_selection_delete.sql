BEGIN;

-- The banner refresh algorithm removes stale daily selections.
-- Previously migration 082 granted only SELECT and INSERT.
-- This migration grants the minimum additional privilege.
GRANT DELETE ON TABLE public.homepage_banner_daily_selections
  TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('131_grant_homepage_daily_selection_delete')
ON CONFLICT(version) DO NOTHING;

COMMIT;
