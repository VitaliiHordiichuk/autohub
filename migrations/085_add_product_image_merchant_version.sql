BEGIN;

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS merchant_url_1500 TEXT,
  ADD COLUMN IF NOT EXISTS merchant_storage_key_1500 TEXT;

INSERT INTO schema_migrations(version) VALUES ('085_add_product_image_merchant_version')
ON CONFLICT(version) DO NOTHING;

COMMIT;
