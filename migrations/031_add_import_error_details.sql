BEGIN;

ALTER TABLE import_rows
  ADD COLUMN IF NOT EXISTS
    source_row_number INTEGER;

ALTER TABLE import_rows
  ADD COLUMN IF NOT EXISTS
    raw_data JSONB;

CREATE INDEX IF NOT EXISTS
  idx_import_rows_import_status
ON import_rows (
  import_id,
  status
);

INSERT INTO schema_migrations (
  version
)
VALUES (
  '031'
)
ON CONFLICT(version)
DO NOTHING;

COMMIT;
