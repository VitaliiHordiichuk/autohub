BEGIN;

-- The classifier can request review without proposing any specific category.
-- Keep that outcome separate from approved category memberships.
CREATE TABLE IF NOT EXISTS product_customer_taxonomy_decisions (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  decision VARCHAR(50) NOT NULL,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_customer_taxonomy_decisions_decision_check CHECK (
    decision IN (
      'PRESERVE_MANUAL', 'PRESERVE_EXISTING_APPROVED_PRIMARY',
      'ASSIGNED_NEW_HIGH', 'ASSIGNED_SAFE', 'REQUIRES_REVIEW',
      'PRESERVED_REJECTED', 'REPLACED_BY_EXPLICIT_OVERRIDE',
      'UNCLASSIFIED', 'UNSUPPORTED', 'NO_ACTION'
    )
  )
);

CREATE INDEX IF NOT EXISTS product_customer_taxonomy_decisions_review_idx
  ON product_customer_taxonomy_decisions(product_id)
  WHERE decision = 'REQUIRES_REVIEW';

INSERT INTO schema_migrations(version)
VALUES ('120_record_customer_taxonomy_import_decisions')
ON CONFLICT(version) DO NOTHING;

COMMIT;
