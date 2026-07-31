BEGIN;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS storage_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS product_images_storage_key_unique
  ON product_images(storage_key) WHERE storage_key IS NOT NULL;
INSERT INTO schema_migrations(version) VALUES ('040_add_product_image_storage_key')
ON CONFLICT(version) DO NOTHING;
COMMIT;
