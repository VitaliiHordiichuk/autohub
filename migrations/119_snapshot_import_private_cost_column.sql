BEGIN;

-- Snapshot the meaning of a private cost column at import time. Import
-- profiles are mutable, so approval of a reviewed product must not reinterpret
-- an old XLSX row using the current profile.
ALTER TABLE public.imports
  ADD COLUMN IF NOT EXISTS private_cost_column INTEGER
  CHECK (private_cost_column BETWEEN 1 AND 100);

INSERT INTO schema_migrations(version)
VALUES ('119_snapshot_import_private_cost_column')
ON CONFLICT(version) DO NOTHING;

COMMIT;
