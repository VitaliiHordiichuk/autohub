BEGIN;

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS image_processing_mode VARCHAR(30) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS image_processing_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS image_review_status VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS image_review_reason VARCHAR(100);

ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_processing_mode_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_processing_mode_check
  CHECK (image_processing_mode IN ('LEGACY', 'SMART_SAFE', 'PRODUCT_MAX', 'PRODUCT_FOCUS'));

ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_review_status_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_review_status_check
  CHECK (image_review_status IN ('APPROVED', 'NEEDS_REVIEW'));

INSERT INTO schema_migrations(version) VALUES ('106_add_smart_product_image_processing')
ON CONFLICT(version) DO NOTHING;

COMMIT;
