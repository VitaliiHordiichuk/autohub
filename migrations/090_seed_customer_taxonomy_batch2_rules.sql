BEGIN;

-- The detector gained additive, closed semantic codes. Preserve every v1/d2
-- row as immutable classification history, then publish a v2/d3 copy for new
-- proposals. Existing memberships deliberately keep their v1 provenance.
UPDATE customer_classification_rules
SET is_active = FALSE,
    updated_at = NOW()
WHERE version = 1
  AND detector_version = 2
  AND is_active = TRUE;

INSERT INTO customer_classification_rules(
  code,
  version,
  detector_version,
  source_kind,
  assignment_role,
  number_family,
  epc_group,
  match_type,
  match_value,
  exclude_values,
  target_category_id,
  priority,
  confidence,
  auto_approval_allowed,
  is_active
)
SELECT
  code,
  2,
  3,
  source_kind,
  assignment_role,
  number_family,
  epc_group,
  match_type,
  match_value,
  exclude_values,
  target_category_id,
  priority,
  confidence,
  auto_approval_allowed,
  TRUE
FROM customer_classification_rules
WHERE version = 1
  AND detector_version = 2
ON CONFLICT(code, version) DO UPDATE SET
  detector_version = EXCLUDED.detector_version,
  source_kind = EXCLUDED.source_kind,
  assignment_role = EXCLUDED.assignment_role,
  number_family = EXCLUDED.number_family,
  epc_group = EXCLUDED.epc_group,
  match_type = EXCLUDED.match_type,
  match_value = EXCLUDED.match_value,
  exclude_values = EXCLUDED.exclude_values,
  target_category_id = EXCLUDED.target_category_id,
  priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence,
  auto_approval_allowed = EXCLUDED.auto_approval_allowed,
  is_active = TRUE,
  updated_at = NOW();

WITH rule_seed(
  code,
  version,
  detector_version,
  source_kind,
  assignment_role,
  number_family,
  epc_group,
  match_type,
  match_value,
  target_category_slug,
  priority,
  confidence,
  auto_approval_allowed,
  is_active
) AS (
  VALUES
    ('STEERING_RACK_A_EPC46_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '46', 'TYPE_CODE', 'STEERING_RACK', 'steering-racks', 100, 'HIGH', TRUE, TRUE),
    ('STEERING_TIE_ROD_A_EPC33_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '33', 'TYPE_CODE', 'STEERING_TIE_ROD', 'steering-tie-rods', 100, 'HIGH', TRUE, TRUE),
    ('STEERING_TIE_ROD_A_EPC35_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '35', 'TYPE_CODE', 'STEERING_TIE_ROD', 'steering-tie-rods', 100, 'HIGH', TRUE, TRUE),
    ('STEERING_TIE_ROD_A_EPC46_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '46', 'TYPE_CODE', 'STEERING_TIE_ROD', 'steering-tie-rods', 100, 'HIGH', TRUE, TRUE),
    ('STEERING_TIE_ROD_END_A_EPC33_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '33', 'TYPE_CODE', 'STEERING_TIE_ROD_END', 'steering-tie-rod-ends', 100, 'HIGH', TRUE, TRUE),
    ('STEERING_TIE_ROD_END_A_EPC46_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '46', 'TYPE_CODE', 'STEERING_TIE_ROD_END', 'steering-tie-rod-ends', 100, 'HIGH', TRUE, TRUE),
    ('STEERING_PUMP_A_EPC46_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '46', 'TYPE_CODE', 'STEERING_PUMP', 'steering-pumps', 100, 'HIGH', TRUE, TRUE),
    ('STEERING_SHAFT_A_EPC46_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '46', 'TYPE_CODE', 'STEERING_SHAFT', 'steering-shafts', 100, 'HIGH', TRUE, TRUE),
    ('STEERING_RESERVOIR_A_EPC46_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '46', 'TYPE_CODE', 'STEERING_RESERVOIR', 'steering-reservoirs', 100, 'HIGH', TRUE, TRUE),
    ('STEERING_HOSE_PIPE_A_EPC46_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '46', 'TYPE_CODE', 'STEERING_HOSE_PIPE', 'steering-hoses-pipes', 100, 'HIGH', TRUE, TRUE),
    ('EXHAUST_CATALYST_A_EPC14_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '14', 'TYPE_CODE', 'EXHAUST_CATALYST', 'exhaust-catalysts', 100, 'HIGH', TRUE, TRUE),
    ('EXHAUST_CATALYST_A_EPC49_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '49', 'TYPE_CODE', 'EXHAUST_CATALYST', 'exhaust-catalysts', 100, 'HIGH', TRUE, TRUE),
    ('EXHAUST_MUFFLER_A_EPC49_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '49', 'TYPE_CODE', 'EXHAUST_MUFFLER', 'exhaust-mufflers', 100, 'HIGH', TRUE, TRUE),
    ('EXHAUST_PIPE_A_EPC14_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '14', 'TYPE_CODE', 'EXHAUST_PIPE', 'exhaust-pipes', 100, 'HIGH', TRUE, TRUE),
    ('EXHAUST_PIPE_A_EPC49_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '49', 'TYPE_CODE', 'EXHAUST_PIPE', 'exhaust-pipes', 100, 'HIGH', TRUE, TRUE),
    ('EXHAUST_SENSOR_A_EPC15_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '15', 'TYPE_CODE', 'EXHAUST_SENSOR', 'exhaust-sensors', 100, 'HIGH', TRUE, TRUE),
    ('EXHAUST_SENSOR_A_EPC90_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'EXHAUST_SENSOR', 'exhaust-sensors', 100, 'HIGH', TRUE, TRUE),
    ('EXHAUST_MOUNT_A_EPC49_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '49', 'TYPE_CODE', 'EXHAUST_MOUNT', 'exhaust-mounts', 100, 'HIGH', TRUE, TRUE),
    ('EXHAUST_MOUNT_A_EPC88_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '88', 'TYPE_CODE', 'EXHAUST_MOUNT', 'exhaust-mounts', 100, 'HIGH', TRUE, TRUE),
    ('EXHAUST_ADBLUE_INJECTOR_A_EPC49_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '49', 'TYPE_CODE', 'EXHAUST_ADBLUE_INJECTOR', 'exhaust-other', 100, 'HIGH', TRUE, TRUE),
    ('WHEEL_RIM_A_EPC40_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '40', 'TYPE_CODE', 'WHEEL_RIM', 'wheels-rims', 100, 'HIGH', TRUE, TRUE),
    ('WHEEL_CAP_A_EPC40_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '40', 'TYPE_CODE', 'WHEEL_CAP', 'wheels-caps', 100, 'HIGH', TRUE, TRUE),
    ('WHEEL_BOLT_NUT_A_EPC40_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '40', 'TYPE_CODE', 'WHEEL_BOLT_NUT', 'wheels-bolts-nuts', 100, 'HIGH', TRUE, TRUE),
    ('WHEEL_BOLT_NUT_A_EPC99_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '99', 'TYPE_CODE', 'WHEEL_BOLT_NUT', 'wheels-bolts-nuts', 100, 'HIGH', TRUE, TRUE),
    ('TPMS_SENSOR_A_EPC90_V1', 1, 3, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'TPMS_SENSOR', 'wheels-pressure-sensors', 100, 'HIGH', TRUE, TRUE)
), resolved_rules AS (
  SELECT seed.*, category.id AS target_category_id
  FROM rule_seed seed
  JOIN customer_categories category
    ON category.slug = seed.target_category_slug
   AND category.status = 'ACTIVE'
   AND category.is_active = TRUE
)
INSERT INTO customer_classification_rules(
  code,
  version,
  detector_version,
  source_kind,
  assignment_role,
  number_family,
  epc_group,
  match_type,
  match_value,
  target_category_id,
  priority,
  confidence,
  auto_approval_allowed,
  is_active
)
SELECT
  code,
  version,
  detector_version,
  source_kind,
  assignment_role,
  number_family,
  epc_group,
  match_type,
  match_value,
  target_category_id,
  priority,
  confidence,
  auto_approval_allowed,
  is_active
FROM resolved_rules
ON CONFLICT(code, version) DO UPDATE SET
  detector_version = EXCLUDED.detector_version,
  source_kind = EXCLUDED.source_kind,
  assignment_role = EXCLUDED.assignment_role,
  number_family = EXCLUDED.number_family,
  epc_group = EXCLUDED.epc_group,
  match_type = EXCLUDED.match_type,
  match_value = EXCLUDED.match_value,
  exclude_values = '{}'::TEXT[],
  target_category_id = EXCLUDED.target_category_id,
  priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence,
  auto_approval_allowed = EXCLUDED.auto_approval_allowed,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

DO $$
DECLARE
  expected_historical_rule_count CONSTANT INTEGER := 119;
  expected_rule_count CONSTANT INTEGER := 25;
  historical_rule_count INTEGER;
  active_successor_count INTEGER;
  actual_rule_count INTEGER;
  duplicate_active_code_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO historical_rule_count
  FROM customer_classification_rules
  WHERE version = 1
    AND detector_version = 2
    AND is_active = FALSE;

  SELECT COUNT(*)::INTEGER
  INTO active_successor_count
  FROM customer_classification_rules successor
  WHERE successor.version = 2
    AND successor.detector_version = 3
    AND successor.is_active = TRUE
    AND EXISTS (
      SELECT 1
      FROM customer_classification_rules historical
      WHERE historical.code = successor.code
        AND historical.version = 1
        AND historical.detector_version = 2
        AND historical.is_active = FALSE
    );

  SELECT COUNT(*)::INTEGER
  INTO actual_rule_count
  FROM customer_classification_rules
  WHERE is_active = TRUE
    AND detector_version = 3
    AND code = ANY(ARRAY[
      'STEERING_RACK_A_EPC46_V1', 'STEERING_TIE_ROD_A_EPC33_V1',
      'STEERING_TIE_ROD_A_EPC35_V1', 'STEERING_TIE_ROD_A_EPC46_V1',
      'STEERING_TIE_ROD_END_A_EPC33_V1', 'STEERING_TIE_ROD_END_A_EPC46_V1',
      'STEERING_PUMP_A_EPC46_V1', 'STEERING_SHAFT_A_EPC46_V1',
      'STEERING_RESERVOIR_A_EPC46_V1', 'STEERING_HOSE_PIPE_A_EPC46_V1',
      'EXHAUST_CATALYST_A_EPC14_V1', 'EXHAUST_CATALYST_A_EPC49_V1',
      'EXHAUST_MUFFLER_A_EPC49_V1', 'EXHAUST_PIPE_A_EPC14_V1',
      'EXHAUST_PIPE_A_EPC49_V1', 'EXHAUST_SENSOR_A_EPC15_V1',
      'EXHAUST_SENSOR_A_EPC90_V1', 'EXHAUST_MOUNT_A_EPC49_V1',
      'EXHAUST_MOUNT_A_EPC88_V1', 'EXHAUST_ADBLUE_INJECTOR_A_EPC49_V1',
      'WHEEL_RIM_A_EPC40_V1', 'WHEEL_CAP_A_EPC40_V1',
      'WHEEL_BOLT_NUT_A_EPC40_V1', 'WHEEL_BOLT_NUT_A_EPC99_V1',
      'TPMS_SENSOR_A_EPC90_V1'
    ]::TEXT[]);

  SELECT COUNT(*)::INTEGER
  INTO duplicate_active_code_count
  FROM (
    SELECT code
    FROM customer_classification_rules
    WHERE is_active = TRUE
    GROUP BY code
    HAVING COUNT(*) > 1
  ) duplicate_active_codes;

  IF historical_rule_count <> expected_historical_rule_count THEN
    RAISE EXCEPTION
      'Customer taxonomy batch 2 expected % historical v1/d2 rules but found %',
      expected_historical_rule_count,
      historical_rule_count;
  END IF;

  IF active_successor_count <> expected_historical_rule_count THEN
    RAISE EXCEPTION
      'Customer taxonomy batch 2 expected % active v2/d3 successors but found %',
      expected_historical_rule_count,
      active_successor_count;
  END IF;

  IF actual_rule_count <> expected_rule_count THEN
    RAISE EXCEPTION
      'Customer taxonomy batch 2 expected % active rules but found %',
      expected_rule_count,
      actual_rule_count;
  END IF;

  IF duplicate_active_code_count <> 0 THEN
    RAISE EXCEPTION
      'Customer taxonomy batch 2 found % codes with multiple active versions',
      duplicate_active_code_count;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('090_seed_customer_taxonomy_batch2_rules')
ON CONFLICT(version) DO NOTHING;

COMMIT;
