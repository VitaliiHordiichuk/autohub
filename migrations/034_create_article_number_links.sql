BEGIN;

CREATE TABLE IF NOT EXISTS article_number_links (
  id BIGSERIAL PRIMARY KEY,

  link_type VARCHAR(30) NOT NULL,

  source_brand_id INTEGER NOT NULL
    REFERENCES brands(id)
    ON DELETE CASCADE,

  source_article VARCHAR(150) NOT NULL,
  source_article_normalized VARCHAR(150)
    NOT NULL,

  target_brand_id INTEGER NOT NULL
    REFERENCES brands(id)
    ON DELETE CASCADE,

  target_article VARCHAR(150) NOT NULL,
  target_article_normalized VARCHAR(150)
    NOT NULL,

  is_active BOOLEAN NOT NULL
    DEFAULT TRUE,

  created_at TIMESTAMP NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT article_number_links_type_check
    CHECK (
      link_type IN (
        'ALIAS',
        'REPLACEMENT',
        'ANALOG'
      )
    ),

  CONSTRAINT article_number_links_source_not_blank
    CHECK (
      NULLIF(
        BTRIM(source_article_normalized),
        ''
      ) IS NOT NULL
    ),

  CONSTRAINT article_number_links_target_not_blank
    CHECK (
      NULLIF(
        BTRIM(target_article_normalized),
        ''
      ) IS NOT NULL
    ),

  CONSTRAINT article_number_links_not_self
    CHECK (
      source_brand_id <>
        target_brand_id
      OR source_article_normalized <>
        target_article_normalized
    ),

  CONSTRAINT article_number_links_unique
    UNIQUE (
      link_type,
      source_brand_id,
      source_article_normalized,
      target_brand_id,
      target_article_normalized
    )
);

CREATE INDEX IF NOT EXISTS
  idx_article_number_links_source
ON article_number_links (
  source_brand_id,
  source_article_normalized,
  link_type,
  is_active
);

CREATE INDEX IF NOT EXISTS
  idx_article_number_links_source_global
ON article_number_links (
  source_article_normalized,
  link_type,
  is_active
);

CREATE INDEX IF NOT EXISTS
  idx_article_number_links_target
ON article_number_links (
  target_brand_id,
  target_article_normalized,
  link_type,
  is_active
);

GRANT SELECT, INSERT, UPDATE, DELETE
ON article_number_links
TO autohub_app;

GRANT USAGE, SELECT
ON SEQUENCE article_number_links_id_seq
TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES (
  '034_create_article_number_links'
)
ON CONFLICT(version)
DO NOTHING;

COMMIT;
