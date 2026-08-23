BEGIN;

ALTER TABLE search_event_results
  ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS warehouse_name VARCHAR(255);

UPDATE search_event_results ser
SET
  supplier_name = COALESCE(
    ser.supplier_name,
    s.name
  ),
  warehouse_name = COALESCE(
    ser.warehouse_name,
    w.name
  )
FROM product_offers po
LEFT JOIN warehouses w
  ON w.id = po.warehouse_id
LEFT JOIN suppliers s
  ON s.id = COALESCE(
    po.supplier_id,
    w.supplier_id
  )
WHERE ser.product_offer_id = po.id
  AND (
    ser.supplier_name IS NULL
    OR ser.warehouse_name IS NULL
  );

INSERT INTO schema_migrations(version)
VALUES ('067_add_search_result_source_details')
ON CONFLICT(version) DO NOTHING;

COMMIT;
