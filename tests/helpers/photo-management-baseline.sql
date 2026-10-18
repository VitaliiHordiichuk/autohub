-- Synthetic baseline for photo-only integration tests, NOT a production schema
-- dump. The repository starts after these legacy tables were already created.
-- Actual photo migrations are applied separately by the isolated test runner.
CREATE TABLE schema_migrations (
  version VARCHAR(100) PRIMARY KEY,
  executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  article TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE product_images (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  url TEXT NOT NULL,
  source TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Empty reference containers used by the GC's row_to_json reference checks.
CREATE TABLE homepage_banners (id SERIAL PRIMARY KEY, image_url TEXT);
CREATE TABLE product_translations (id SERIAL PRIMARY KEY, description TEXT);
CREATE TABLE customer_category_translations (id SERIAL PRIMARY KEY, description TEXT);
INSERT INTO products(article,name) VALUES ('PHOTO-REVIEW-ONLY','Synthetic photo test product');
