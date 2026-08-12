BEGIN;

CREATE TABLE IF NOT EXISTS homepage_banners (
  id BIGSERIAL PRIMARY KEY,
  scheduled_date DATE,
  title_uk VARCHAR(180) NOT NULL,
  description_uk TEXT NOT NULL,
  title_en VARCHAR(180) NOT NULL,
  description_en TEXT NOT NULL,
  desktop_image_url TEXT NOT NULL,
  tablet_image_url TEXT NOT NULL,
  mobile_image_url TEXT NOT NULL,
  desktop_storage_key TEXT,
  tablet_storage_key TEXT,
  mobile_storage_key TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS homepage_banners_scheduled_date_unique
  ON homepage_banners(scheduled_date)
  WHERE scheduled_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS homepage_banners_active_date
  ON homepage_banners(is_active, scheduled_date);

CREATE TABLE IF NOT EXISTS homepage_product_features (
  id BIGSERIAL PRIMARY KEY,
  feature_type VARCHAR(16) NOT NULL
    CHECK (feature_type IN ('PROMOTION', 'NEW')),
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  discount_percent NUMERIC(5,2)
    CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent < 100)),
  starts_on DATE,
  ends_on DATE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on),
  CHECK (feature_type = 'PROMOTION' OR discount_percent IS NULL)
);

CREATE INDEX IF NOT EXISTS homepage_product_features_active_period
  ON homepage_product_features(is_active, feature_type, starts_on, ends_on, sort_order);

INSERT INTO homepage_banners(
  scheduled_date,
  title_uk,
  description_uk,
  title_en,
  description_en,
  desktop_image_url,
  tablet_image_url,
  mobile_image_url,
  is_active
)
SELECT
  NULL,
  'DS8 Zeppelin — вершина розкоші',
  'У 1930 році Maybach DS8 Zeppelin отримав двигун V12 об’ємом 8,0 л і 8-ступеневу коробку передач, у якій передачі можна було перемикати без вижиму зчеплення.',
  'DS8 Zeppelin — the height of luxury',
  'In 1930, the Maybach DS8 Zeppelin featured an 8.0-litre V12 and an eight-speed transmission that allowed gear changes without using the clutch.',
  '/landing/daily-fact-ds8-desktop.png',
  '/landing/daily-fact-ds8-tablet.png',
  '/landing/daily-fact-ds8-mobile.png',
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM homepage_banners);

UPDATE site_languages
SET
  is_default = (code = 'uk'),
  is_public_enabled = (code IN ('uk', 'en')),
  is_admin_enabled = (code IN ('uk', 'en'))
WHERE code IN ('uk', 'en', 'ru');

GRANT SELECT, INSERT, UPDATE, DELETE ON homepage_banners TO autohub_app;
GRANT USAGE, SELECT ON SEQUENCE homepage_banners_id_seq TO autohub_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON homepage_product_features TO autohub_app;
GRANT USAGE, SELECT ON SEQUENCE homepage_product_features_id_seq TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('059_create_homepage_content')
ON CONFLICT(version) DO NOTHING;

COMMIT;
