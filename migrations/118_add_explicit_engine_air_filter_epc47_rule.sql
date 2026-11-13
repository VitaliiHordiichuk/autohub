BEGIN;

-- No category or existing assignment changes. The detector requires explicit
-- engine-air-filter wording; EPC 47 alone never matches this TYPE_CODE rule.
WITH target AS (
  SELECT id FROM customer_categories
  WHERE slug = 'filters-engine-air' AND status = 'ACTIVE' AND is_active = TRUE
)
INSERT INTO customer_classification_rules(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value, exclude_values,
  target_category_id, priority, confidence, auto_approval_allowed, is_active
)
SELECT
  'FILTER_AIR_ENGINE_A_EPC47_V1', 1, 10, 'RULE', 'PRIMARY',
  'A', '47', 'TYPE_CODE', 'FILTER_AIR_ENGINE', '{}'::TEXT[],
  target.id, 100, 'HIGH', TRUE, TRUE
FROM target
ON CONFLICT(code, version) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM customer_classification_rules rule
      JOIN customer_categories category ON category.id = rule.target_category_id
      WHERE rule.code = 'FILTER_AIR_ENGINE_A_EPC47_V1'
        AND rule.version = 1 AND rule.detector_version = 10
        AND rule.is_active = TRUE AND rule.auto_approval_allowed = TRUE
        AND category.slug = 'filters-engine-air') <> 1 THEN
    RAISE EXCEPTION 'Expected one active explicit EPC47 engine air filter rule';
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('118_add_explicit_engine_air_filter_epc47_rule')
ON CONFLICT(version) DO NOTHING;

COMMIT;
