BEGIN;

-- Explicit owner-approved part semantics are stronger than these broad,
-- mixed EPC groups. EPC 47 already has an active AdBlue rule. No product
-- assignment or backfill happens here.
WITH seed(code, epc_group, match_value, target_slug) AS (
  VALUES
    ('ADBLUE_SCR_COMPONENT_A_EPC14_EXPLICIT_V1', '14', 'ADBLUE_SCR_COMPONENT', 'exhaust-adblue-scr'),
    ('ADBLUE_SCR_COMPONENT_A_EPC15_EXPLICIT_V1', '15', 'ADBLUE_SCR_COMPONENT', 'exhaust-adblue-scr'),
    ('ADBLUE_SCR_COMPONENT_A_EPC49_EXPLICIT_V1', '49', 'ADBLUE_SCR_COMPONENT', 'exhaust-adblue-scr'),
    ('ADBLUE_SCR_COMPONENT_A_EPC90_EXPLICIT_V1', '90', 'ADBLUE_SCR_COMPONENT', 'exhaust-adblue-scr'),
    ('ADBLUE_SCR_COMPONENT_A_EPC98_EXPLICIT_V1', '98', 'ADBLUE_SCR_COMPONENT', 'exhaust-adblue-scr'),
    ('ENGINE_PRESSURE_VALVE_A_EPC15_EXPLICIT_V1', '15', 'ENGINE_SENSOR', 'engine-sensors')
), target AS (
  SELECT id, slug FROM customer_categories
  WHERE slug IN ('exhaust-adblue-scr', 'engine-sensors')
    AND status = 'ACTIVE' AND is_active = TRUE
)
INSERT INTO customer_classification_rules (
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value,
  target_category_id, priority, confidence, auto_approval_allowed, is_active
)
SELECT
  seed.code, 1, 10, 'RULE', 'PRIMARY',
  'A', seed.epc_group, 'TYPE_CODE', seed.match_value,
  target.id, 100, 'HIGH', TRUE, TRUE
FROM seed JOIN target ON target.slug = seed.target_slug
ON CONFLICT (code, version) DO UPDATE SET
  detector_version = EXCLUDED.detector_version,
  target_category_id = EXCLUDED.target_category_id,
  is_active = TRUE,
  updated_at = NOW();

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM customer_classification_rules
      WHERE code IN (
        'ADBLUE_SCR_COMPONENT_A_EPC14_EXPLICIT_V1',
        'ADBLUE_SCR_COMPONENT_A_EPC15_EXPLICIT_V1',
        'ADBLUE_SCR_COMPONENT_A_EPC49_EXPLICIT_V1',
        'ADBLUE_SCR_COMPONENT_A_EPC90_EXPLICIT_V1',
        'ADBLUE_SCR_COMPONENT_A_EPC98_EXPLICIT_V1',
        'ENGINE_PRESSURE_VALVE_A_EPC15_EXPLICIT_V1'
      ) AND is_active = TRUE AND detector_version = 10) <> 6 THEN
    RAISE EXCEPTION 'An owner-approved target or one of its six rules is missing';
  END IF;
END $$;

INSERT INTO schema_migrations(version)
VALUES ('121_classify_explicit_owner_approved_parts')
ON CONFLICT (version) DO NOTHING;

COMMIT;
