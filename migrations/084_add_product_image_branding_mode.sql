BEGIN;

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS image_branding_mode VARCHAR(30) NOT NULL DEFAULT 'FULL_BRANDED';

ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_branding_mode_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_branding_mode_check
  CHECK (image_branding_mode IN ('CLEAN', 'STAMP_ONLY', 'FULL_BRANDED'));

INSERT INTO schema_migrations(version) VALUES ('084_add_product_image_branding_mode')
ON CONFLICT(version) DO NOTHING;

COMMIT;
