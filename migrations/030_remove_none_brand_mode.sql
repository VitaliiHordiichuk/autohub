BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM supplier_import_settings
    WHERE brand_mode NOT IN (
      'FIXED',
      'FROM_FILE'
    )
  ) THEN
    RAISE EXCEPTION
      'В supplier_import_settings обнаружен неподдерживаемый режим бренда';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM warehouse_import_settings
    WHERE brand_mode NOT IN (
      'FIXED',
      'FROM_FILE'
    )
  ) THEN
    RAISE EXCEPTION
      'В warehouse_import_settings обнаружен неподдерживаемый режим бренда';
  END IF;
END
$$;

ALTER TABLE supplier_import_settings
  ALTER COLUMN brand_mode
  DROP DEFAULT;

ALTER TABLE warehouse_import_settings
  ALTER COLUMN brand_mode
  DROP DEFAULT;

ALTER TABLE supplier_import_settings
  DROP CONSTRAINT IF EXISTS
    supplier_import_settings_brand_mode_check;

ALTER TABLE supplier_import_settings
  ADD CONSTRAINT
    supplier_import_settings_brand_mode_check
  CHECK (
    brand_mode IN (
      'FIXED',
      'FROM_FILE'
    )
  );

ALTER TABLE warehouse_import_settings
  DROP CONSTRAINT IF EXISTS
    warehouse_import_settings_brand_mode_check;

ALTER TABLE warehouse_import_settings
  ADD CONSTRAINT
    warehouse_import_settings_brand_mode_check
  CHECK (
    brand_mode IN (
      'FIXED',
      'FROM_FILE'
    )
  );

INSERT INTO schema_migrations (
  version
)
VALUES (
  '030'
)
ON CONFLICT(version)
DO NOTHING;

COMMIT;
