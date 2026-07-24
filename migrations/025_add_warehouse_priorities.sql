BEGIN;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS
    warehouse_priority_enabled BOOLEAN
    NOT NULL DEFAULT FALSE;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS
    priority INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'warehouses_priority_positive_check'
  ) THEN
    ALTER TABLE warehouses
      ADD CONSTRAINT
        warehouses_priority_positive_check
      CHECK (
        priority IS NULL
        OR priority > 0
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS
  idx_warehouses_supplier_priority
ON warehouses (
  supplier_id,
  priority
)
WHERE priority IS NOT NULL;

INSERT INTO schema_migrations(version)
VALUES (
  '025_add_warehouse_priorities'
)
ON CONFLICT(version) DO NOTHING;

COMMIT;
