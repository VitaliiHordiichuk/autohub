BEGIN;

ALTER TABLE warehouse_import_settings
ADD COLUMN IF NOT EXISTS start_row INTEGER DEFAULT 2;

UPDATE warehouse_import_settings
SET start_row = 2
WHERE start_row IS NULL;

COMMIT;