BEGIN;

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS
    is_active BOOLEAN NOT NULL
    DEFAULT TRUE;

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS
    updated_at TIMESTAMP NOT NULL
    DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE brand_aliases
  ADD COLUMN IF NOT EXISTS
    is_primary BOOLEAN NOT NULL
    DEFAULT FALSE;

UPDATE brand_aliases AS ba
SET is_primary = TRUE
FROM brands AS b
WHERE b.id = ba.brand_id
  AND ba.alias_normalized = UPPER(
    REGEXP_REPLACE(
      b.name,
      '[^[:alnum:]]+',
      '',
      'g'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS
  brand_aliases_one_primary_per_brand
ON brand_aliases(brand_id)
WHERE is_primary = TRUE;

INSERT INTO schema_migrations(version)
VALUES ('029')
ON CONFLICT(version)
DO NOTHING;

COMMIT;
