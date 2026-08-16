BEGIN;

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS original_url TEXT,
  ADD COLUMN IF NOT EXISTS original_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS processed_url_1600 TEXT,
  ADD COLUMN IF NOT EXISTS processed_url_1200 TEXT,
  ADD COLUMN IF NOT EXISTS processed_url_800 TEXT,
  ADD COLUMN IF NOT EXISTS processed_url_400 TEXT,
  ADD COLUMN IF NOT EXISTS processed_storage_key_1600 TEXT,
  ADD COLUMN IF NOT EXISTS processed_storage_key_1200 TEXT,
  ADD COLUMN IF NOT EXISTS processed_storage_key_800 TEXT,
  ADD COLUMN IF NOT EXISTS processed_storage_key_400 TEXT,
  ADD COLUMN IF NOT EXISTS processing_status VARCHAR(30) NOT NULL DEFAULT 'ORIGINAL_ONLY',
  ADD COLUMN IF NOT EXISTS display_mode VARCHAR(20) NOT NULL DEFAULT 'ORIGINAL',
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS processing_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;

UPDATE product_images
SET original_url = COALESCE(original_url, url),
    original_storage_key = COALESCE(original_storage_key, storage_key)
WHERE original_url IS NULL OR original_storage_key IS NULL;

ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_processing_status_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_processing_status_check
  CHECK (processing_status IN ('ORIGINAL_ONLY', 'PROCESSING', 'PROCESSED', 'FAILED'));

ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_display_mode_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_display_mode_check
  CHECK (display_mode IN ('ORIGINAL', 'PROCESSED'));

CREATE INDEX IF NOT EXISTS product_images_processing_status_idx
  ON product_images(processing_status);

INSERT INTO schema_migrations(version) VALUES ('061_add_product_image_processing')
ON CONFLICT(version) DO NOTHING;

COMMIT;
