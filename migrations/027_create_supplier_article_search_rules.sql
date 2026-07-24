BEGIN;

CREATE TABLE IF NOT EXISTS
  supplier_article_search_rules (
    id SERIAL PRIMARY KEY,

    supplier_id INTEGER NOT NULL
      REFERENCES suppliers(id)
      ON DELETE CASCADE,

    rule_code VARCHAR(80) NOT NULL,

    is_enabled BOOLEAN
      NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP
      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP
      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (
      supplier_id,
      rule_code
    )
  );

CREATE INDEX IF NOT EXISTS
  idx_supplier_article_search_rules_active
ON supplier_article_search_rules (
  supplier_id,
  rule_code,
  is_enabled
);

INSERT INTO schema_migrations(version)
VALUES (
  '027_create_supplier_article_search_rules'
)
ON CONFLICT(version) DO NOTHING;

COMMIT;
