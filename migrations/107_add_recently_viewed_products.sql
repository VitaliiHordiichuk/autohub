BEGIN;

CREATE TABLE IF NOT EXISTS client_recently_viewed_products (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT client_recently_viewed_products_user_product_key
    UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_client_recently_viewed_products_user_time
  ON client_recently_viewed_products (user_id, viewed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_client_recently_viewed_products_retention
  ON client_recently_viewed_products (viewed_at, id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autohub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON client_recently_viewed_products TO autohub_app;
    GRANT USAGE, SELECT
      ON SEQUENCE client_recently_viewed_products_id_seq TO autohub_app;
  END IF;
END $$;

INSERT INTO schema_migrations(version)
VALUES ('107_add_recently_viewed_products')
ON CONFLICT(version) DO NOTHING;

COMMIT;
