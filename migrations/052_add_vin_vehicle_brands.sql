ALTER TABLE vehicle_brands ADD COLUMN IF NOT EXISTS is_vin_supported BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE vehicle_brands SET is_vin_supported=TRUE WHERE LOWER(name) IN ('mercedes-benz','mercedes benz','mercedes');
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_brands_name_lower ON vehicle_brands(LOWER(name));
ALTER TABLE vin_requests ADD COLUMN IF NOT EXISTS vehicle_brand_id INTEGER REFERENCES vehicle_brands(id) ON DELETE RESTRICT;
INSERT INTO schema_migrations(version) VALUES ('052_add_vin_vehicle_brands') ON CONFLICT (version) DO NOTHING;
