BEGIN;

CREATE TABLE IF NOT EXISTS brand_aliases (
  id SERIAL PRIMARY KEY,

  brand_id INTEGER NOT NULL
    REFERENCES brands(id)
    ON DELETE CASCADE,

  alias VARCHAR(150) NOT NULL,

  alias_normalized VARCHAR(150)
    NOT NULL,

  is_active BOOLEAN NOT NULL
    DEFAULT TRUE,

  created_at TIMESTAMP NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT brand_aliases_alias_not_blank
    CHECK (
      NULLIF(BTRIM(alias), '') IS NOT NULL
    ),

  CONSTRAINT brand_aliases_normalized_not_blank
    CHECK (
      NULLIF(BTRIM(alias_normalized), '')
      IS NOT NULL
    ),

  CONSTRAINT brand_aliases_normalized_unique
    UNIQUE(alias_normalized)
);

CREATE INDEX IF NOT EXISTS
  idx_brand_aliases_brand_id
ON brand_aliases(
  brand_id,
  is_active
);

INSERT INTO brand_aliases (
  brand_id,
  alias,
  alias_normalized
)
SELECT
  b.id,
  b.name,
  UPPER(
    REGEXP_REPLACE(
      b.name,
      '[^[:alnum:]]+',
      '',
      'g'
    )
  )
FROM brands AS b
WHERE NULLIF(
  UPPER(
    REGEXP_REPLACE(
      b.name,
      '[^[:alnum:]]+',
      '',
      'g'
    )
  ),
  ''
) IS NOT NULL
ON CONFLICT(alias_normalized)
DO NOTHING;

INSERT INTO schema_migrations (
  version
)
VALUES (
  '028'
)
ON CONFLICT(version)
DO NOTHING;

COMMIT;
