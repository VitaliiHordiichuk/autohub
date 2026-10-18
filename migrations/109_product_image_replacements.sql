BEGIN;

-- Historical replacement records are kept separately from product_images so public
-- catalog, SEO and Merchant queries never accidentally expose a replaced photograph.
-- Deleting an active image is blocked while it still has replacement aliases.
CREATE TABLE IF NOT EXISTS product_image_replacements (
  old_image_id BIGINT PRIMARY KEY,
  product_id INTEGER NOT NULL,
  current_image_id BIGINT NOT NULL,
  old_snapshot JSONB NOT NULL,
  old_preview_url TEXT,
  replaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_image_replacements_distinct CHECK (old_image_id <> current_image_id)
);
CREATE INDEX IF NOT EXISTS product_image_replacements_product_idx
  ON product_image_replacements (product_id, replaced_at DESC);
CREATE INDEX IF NOT EXISTS product_image_replacements_target_idx
  ON product_image_replacements (current_image_id);

INSERT INTO schema_migrations(version) VALUES ('109_product_image_replacements')
  ON CONFLICT DO NOTHING;
COMMIT;
