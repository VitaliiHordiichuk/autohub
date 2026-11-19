BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS image_display_frame JSONB;
ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_display_frame_object;
ALTER TABLE product_images ADD CONSTRAINT product_images_display_frame_object
 CHECK(image_display_frame IS NULL OR jsonb_typeof(image_display_frame)='object');
INSERT INTO schema_migrations(version) VALUES('134_product_image_display_framing') ON CONFLICT(version) DO NOTHING;
COMMIT;
