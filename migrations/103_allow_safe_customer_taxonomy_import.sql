BEGIN;

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
          AND assignment_origin IN ('BACKFILL', 'IMPORT')
        )
      )
    )
  );

INSERT INTO schema_migrations(version)
VALUES ('103_allow_safe_customer_taxonomy_import')
ON CONFLICT(version) DO NOTHING;

COMMIT;
