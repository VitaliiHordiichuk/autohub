BEGIN;

CREATE INDEX IF NOT EXISTS
  idx_product_categories_category_product
ON product_categories(category_id, product_id);

CREATE INDEX IF NOT EXISTS
  idx_product_images_product_priority
ON product_images(product_id, priority, id);

CREATE INDEX IF NOT EXISTS
  idx_product_offers_public_product
ON product_offers(product_id)
WHERE is_available = TRUE
  AND is_hidden = FALSE;

INSERT INTO schema_migrations(version)
VALUES ('081_optimize_public_catalog')
ON CONFLICT(version) DO NOTHING;

COMMIT;
