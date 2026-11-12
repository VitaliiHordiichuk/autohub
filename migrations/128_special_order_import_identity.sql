-- Associate each new Mercedes TXT import with its source upload.
-- Existing legacy imports remain unmodified and have NULL identity.
-- Apply only to an explicitly verified database.

BEGIN;

ALTER TABLE special_order_import_runs
  ADD COLUMN upload_file_id UUID,
  ADD COLUMN source_sha256 VARCHAR(64);

ALTER TABLE special_order_import_runs
  ADD CONSTRAINT chk_special_order_import_sha256
  CHECK (
    source_sha256 IS NULL
    OR source_sha256 ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE special_order_import_runs
  ADD CONSTRAINT chk_special_order_import_identity_pair
  CHECK (
    (upload_file_id IS NULL AND source_sha256 IS NULL)
    OR
    (upload_file_id IS NOT NULL AND source_sha256 IS NOT NULL)
  );

CREATE UNIQUE INDEX idx_special_order_import_upload_unique
  ON special_order_import_runs (
    source_key,
    upload_file_id
  )
  WHERE upload_file_id IS NOT NULL;

INSERT INTO schema_migrations(version)
VALUES ('128_special_order_import_identity');

COMMIT;
