BEGIN;

ALTER TABLE homepage_banners
  ADD COLUMN IF NOT EXISTS title_ru VARCHAR(180),
  ADD COLUMN IF NOT EXISTS description_ru TEXT;

UPDATE homepage_banners
SET
  title_ru = COALESCE(title_ru, title_uk),
  description_ru = COALESCE(description_ru, description_uk)
WHERE title_ru IS NULL OR description_ru IS NULL;

UPDATE site_languages
SET
  native_name = CASE
    WHEN code = 'ru' THEN 'русский'
    ELSE native_name
  END,
  is_public_enabled = TRUE,
  is_admin_enabled = TRUE,
  sort_order = CASE code
    WHEN 'uk' THEN 10
    WHEN 'en' THEN 20
    WHEN 'ru' THEN 30
    ELSE sort_order
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE code IN ('uk', 'en', 'ru');

UPDATE site_languages
SET
  is_default = (code = 'uk'),
  updated_at = CURRENT_TIMESTAMP
WHERE code IN ('uk', 'en', 'ru');

INSERT INTO schema_migrations(version)
VALUES ('062_enable_russian_public_language')
ON CONFLICT(version) DO NOTHING;

COMMIT;
