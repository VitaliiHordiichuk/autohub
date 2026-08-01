ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS returnable_by_default BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS is_returnable BOOLEAN;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_returnable BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO schema_migrations(version)
VALUES ('050_add_returnability_rules')
ON CONFLICT (version) DO NOTHING;
