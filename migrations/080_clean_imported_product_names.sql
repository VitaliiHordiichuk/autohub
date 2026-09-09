BEGIN;

WITH normalized AS (
  SELECT
    product.id,
    BTRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                product.name,
                '[[:cntrl:]]',
                ' ',
                'g'
              ),
              '[[:space:]]+',
              ' ',
              'g'
            ),
            '^[[:space:]./\\|,:;#·•–—-]+',
            '',
            'g'
          ),
          '[[:space:]]*(/{1,}|\\{1,}|\|{1,}|[,;:#]|[-–—]{1,}|\({1,}|\.{2,})[[:space:]]*$',
          '',
          'g'
        ),
        '[[:space:]]*/{2,}[[:space:]]*',
        ' / ',
        'g'
      )
    ) AS clean_name
  FROM products product
), protected AS (
  SELECT DISTINCT translation.product_id
  FROM product_translations translation
  JOIN site_languages language
    ON language.code = translation.language_code
  WHERE
    translation.provider = 'MANUAL'
    AND language.is_default = TRUE
)
UPDATE products product
SET
  name = normalized.clean_name,
  updated_at = CURRENT_TIMESTAMP
FROM normalized
LEFT JOIN protected
  ON protected.product_id = normalized.id
WHERE
  product.id = normalized.id
  AND protected.product_id IS NULL
  AND NULLIF(normalized.clean_name, '') IS NOT NULL
  AND product.name IS DISTINCT FROM normalized.clean_name;

WITH normalized AS (
  SELECT
    translation.product_id,
    translation.language_code,
    BTRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                translation.name,
                '[[:cntrl:]]',
                ' ',
                'g'
              ),
              '[[:space:]]+',
              ' ',
              'g'
            ),
            '^[[:space:]./\\|,:;#·•–—-]+',
            '',
            'g'
          ),
          '[[:space:]]*(/{1,}|\\{1,}|\|{1,}|[,;:#]|[-–—]{1,}|\({1,}|\.{2,})[[:space:]]*$',
          '',
          'g'
        ),
        '[[:space:]]*/{2,}[[:space:]]*',
        ' / ',
        'g'
      )
    ) AS clean_name
  FROM product_translations translation
  WHERE translation.provider IS DISTINCT FROM 'MANUAL'
)
UPDATE product_translations translation
SET
  name = normalized.clean_name,
  updated_at = CURRENT_TIMESTAMP
FROM normalized
WHERE
  translation.product_id = normalized.product_id
  AND translation.language_code = normalized.language_code
  AND NULLIF(normalized.clean_name, '') IS NOT NULL
  AND translation.name IS DISTINCT FROM normalized.clean_name;

INSERT INTO schema_migrations(version)
VALUES ('080_clean_imported_product_names')
ON CONFLICT(version) DO NOTHING;

COMMIT;
