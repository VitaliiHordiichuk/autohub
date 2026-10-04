BEGIN;

-- SAFE_TOPLEVEL is a reviewed, explicit EPC fallback. It is intentionally
-- distinct from narrow RULE/HIGH classification and therefore carries no
-- rule reference. Existing RULE/HIGH and historical EPC_FALLBACK/HIGH rows
-- remain valid.
ALTER TABLE product_customer_categories
  DROP CONSTRAINT IF EXISTS product_customer_categories_rule_source_check;

ALTER TABLE product_customer_categories
  ADD CONSTRAINT product_customer_categories_rule_source_check
  CHECK (
    assignment_source <> 'RULE'
    OR rule_code IS NOT NULL
  );

ALTER TABLE product_customer_categories
  DROP CONSTRAINT IF EXISTS product_customer_categories_auto_approval_check;

ALTER TABLE product_customer_categories
  ADD CONSTRAINT product_customer_categories_auto_approval_check
  CHECK (
    approval_status <> 'AUTO_APPROVED'
    OR (
      assignment_source = 'RULE'
      AND confidence = 'HIGH'
      AND rule_code IS NOT NULL
    )
    OR (
      assignment_source = 'EPC_FALLBACK'
      AND (
        (confidence = 'HIGH' AND rule_code IS NOT NULL)
        OR (
          confidence = 'MEDIUM'
          AND rule_code IS NULL
          AND assignment_origin = 'BACKFILL'
        )
      )
    )
  );

INSERT INTO schema_migrations(version)
VALUES ('092_allow_safe_top_level_taxonomy_fallback')
ON CONFLICT(version) DO NOTHING;

COMMIT;
