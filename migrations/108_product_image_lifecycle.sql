BEGIN;

ALTER TABLE product_images ADD COLUMN IF NOT EXISTS processing_request_id BIGINT NOT NULL DEFAULT 0;

-- No FK cascade: originals, upload intents and published URL aliases survive image removal.
CREATE TABLE IF NOT EXISTS product_image_objects (
  storage_key TEXT PRIMARY KEY,
  image_id BIGINT,
  product_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('original','site-1500','site-1200','site-800','site-400','merchant-1500')),
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  state TEXT NOT NULL CHECK (state IN ('STAGED','CURRENT','RETIRED','DELETING','DELETED')),
  public_url TEXT,
  legacy_public BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delete_after TIMESTAMPTZ,
  delete_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS product_image_objects_image_idx ON product_image_objects(image_id);
CREATE INDEX IF NOT EXISTS product_image_objects_gc_idx ON product_image_objects(delete_after)
  WHERE state IN ('STAGED','RETIRED','DELETING') AND NOT legacy_public AND role <> 'original';
CREATE INDEX IF NOT EXISTS product_image_objects_alias_idx ON product_image_objects(image_id,role,sha256)
  WHERE published_at IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES ('108_product_image_lifecycle') ON CONFLICT DO NOTHING;
COMMIT;
