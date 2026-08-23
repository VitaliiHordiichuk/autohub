BEGIN;

CREATE TABLE IF NOT EXISTS product_removal_log (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  article VARCHAR(255) NOT NULL,
  product_name VARCHAR(255),
  removed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_removal_log_removed_at
  ON product_removal_log(removed_at DESC);

INSERT INTO schema_migrations(version)
VALUES ('066_add_product_removal_log')
ON CONFLICT(version) DO NOTHING;

COMMIT;
