BEGIN;

UPDATE products product
SET
  name = manual_translation.name,
  updated_at = CURRENT_TIMESTAMP
FROM product_translations manual_translation
JOIN site_languages language
  ON language.code = manual_translation.language_code
WHERE
  manual_translation.product_id = product.id
  AND manual_translation.provider = 'MANUAL'
  AND language.is_default = TRUE
  AND NULLIF(BTRIM(manual_translation.name), '') IS NOT NULL
  AND product.name IS DISTINCT FROM manual_translation.name;

CREATE OR REPLACE FUNCTION preserve_manual_product_name()
RETURNS TRIGGER AS $$
DECLARE
  saved_manual_name TEXT;
BEGIN
  SELECT NULLIF(BTRIM(translation.name), '')
  INTO saved_manual_name
  FROM product_translations translation
  JOIN site_languages language
    ON language.code = translation.language_code
  WHERE
    translation.product_id = OLD.id
    AND translation.provider = 'MANUAL'
    AND language.is_default = TRUE
  ORDER BY
    language.sort_order ASC,
    translation.updated_at DESC
  LIMIT 1;

  IF
    saved_manual_name IS NOT NULL
    AND NEW.name IS DISTINCT FROM saved_manual_name
  THEN
    NEW.name := saved_manual_name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_preserve_manual_name
ON products;

CREATE TRIGGER products_preserve_manual_name
BEFORE UPDATE OF name ON products
FOR EACH ROW
EXECUTE FUNCTION preserve_manual_product_name();

INSERT INTO schema_migrations(version)
VALUES ('075_preserve_manual_product_names')
ON CONFLICT(version) DO NOTHING;

COMMIT;
