BEGIN;

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS original_width INTEGER,
  ADD COLUMN IF NOT EXISTS original_height INTEGER,
  ADD COLUMN IF NOT EXISTS processed_width INTEGER,
  ADD COLUMN IF NOT EXISTS processed_height INTEGER,
  ADD COLUMN IF NOT EXISTS image_quality_status VARCHAR(30);

ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_original_width_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_original_width_check
  CHECK (original_width IS NULL OR original_width > 0);

ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_original_height_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_original_height_check
  CHECK (original_height IS NULL OR original_height > 0);

ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_processed_width_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_processed_width_check
  CHECK (processed_width IS NULL OR processed_width > 0);

ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_processed_height_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_processed_height_check
  CHECK (processed_height IS NULL OR processed_height > 0);

ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_quality_status_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_quality_status_check
  CHECK (image_quality_status IS NULL OR image_quality_status IN ('GOOD', 'OK', 'LOW_RESOLUTION'));

INSERT INTO schema_migrations(version) VALUES ('083_add_product_image_quality_metadata')
ON CONFLICT(version) DO NOTHING;

COMMIT;
