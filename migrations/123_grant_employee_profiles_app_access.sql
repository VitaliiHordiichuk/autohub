BEGIN;

-- Migration 122 creates the table as the migration role. Match the existing
-- application-table privileges without requiring autohub_app in test databases.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autohub_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employee_profiles TO autohub_app';
  END IF;
END
$$;

INSERT INTO schema_migrations(version)
VALUES ('123_grant_employee_profiles_app_access')
ON CONFLICT (version) DO NOTHING;

COMMIT;
