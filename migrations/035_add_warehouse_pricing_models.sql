BEGIN;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS pricing_model VARCHAR(30) NOT NULL DEFAULT 'SUPPLIER_MARKUP',
  ADD COLUMN IF NOT EXISTS retail_markup_percent NUMERIC(7,3) NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS minimum_markup_percent NUMERIC(7,3) NOT NULL DEFAULT 10;

ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_pricing_model_check;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_pricing_model_check
  CHECK (pricing_model IN ('OWN_DUAL_PRICE', 'SUPPLIER_MARKUP'));
ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_markup_check;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_markup_check
  CHECK (retail_markup_percent >= 0 AND minimum_markup_percent >= 0
    AND retail_markup_percent >= minimum_markup_percent);

ALTER TABLE supplier_import_settings
  ADD COLUMN IF NOT EXISTS retail_price_column INTEGER;
ALTER TABLE warehouse_import_settings
  ADD COLUMN IF NOT EXISTS retail_price_column INTEGER;
ALTER TABLE product_offers
  ADD COLUMN IF NOT EXISTS minimum_sale_price NUMERIC(12,2);

UPDATE warehouses w
SET pricing_model = 'OWN_DUAL_PRICE',
    minimum_markup_percent = 0
FROM suppliers s
WHERE w.supplier_id = s.id AND s.type = 'OWN';

UPDATE product_offers po
SET minimum_sale_price = po.purchase_price
FROM warehouses w
WHERE po.warehouse_id = w.id
  AND w.pricing_model = 'OWN_DUAL_PRICE'
  AND po.minimum_sale_price IS NULL;

INSERT INTO schema_migrations(version)
VALUES ('035_add_warehouse_pricing_models')
ON CONFLICT(version) DO NOTHING;

COMMIT;
