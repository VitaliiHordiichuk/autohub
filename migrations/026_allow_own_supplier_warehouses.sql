BEGIN;

ALTER TABLE warehouses
  DROP CONSTRAINT IF EXISTS
    warehouses_supplier_type_check;

ALTER TABLE warehouses
  ADD CONSTRAINT
    warehouses_supplier_link_check
  CHECK (
    supplier_id IS NOT NULL
    OR type = 'OWN'
  );

INSERT INTO schema_migrations(version)
VALUES (
  '026_allow_own_supplier_warehouses'
)
ON CONFLICT(version) DO NOTHING;

COMMIT;
