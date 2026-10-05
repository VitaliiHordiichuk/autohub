BEGIN;

-- Detector v8 preserves every v7 rule row for historical memberships and
-- publishes one successor for new classifications. No membership is written.
INSERT INTO customer_classification_rules(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value, exclude_values,
  target_category_id, priority, confidence, auto_approval_allowed, is_active
)
SELECT previous.code, previous.version + 1, 8, previous.source_kind,
  previous.assignment_role, previous.number_family, previous.epc_group,
  previous.match_type, previous.match_value, previous.exclude_values,
  previous.target_category_id, previous.priority, previous.confidence,
  previous.auto_approval_allowed, FALSE
FROM customer_classification_rules previous
WHERE previous.detector_version = 7
  AND previous.version = (
    SELECT MAX(candidate.version) FROM customer_classification_rules candidate
    WHERE candidate.code = previous.code AND candidate.detector_version = 7
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_classification_rules newer
    WHERE newer.code = previous.code AND newer.detector_version > 7
  )
ON CONFLICT(code, version) DO UPDATE SET
  detector_version = EXCLUDED.detector_version, source_kind = EXCLUDED.source_kind,
  assignment_role = EXCLUDED.assignment_role, number_family = EXCLUDED.number_family,
  epc_group = EXCLUDED.epc_group, match_type = EXCLUDED.match_type,
  match_value = EXCLUDED.match_value, exclude_values = EXCLUDED.exclude_values,
  target_category_id = EXCLUDED.target_category_id, priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence, auto_approval_allowed = EXCLUDED.auto_approval_allowed,
  updated_at = NOW();

UPDATE customer_classification_rules SET is_active = FALSE, updated_at = NOW()
WHERE detector_version = 7 AND is_active = TRUE;

WITH rule_seed(
  code, version, detector_version, source_kind, assignment_role, number_family,
  epc_group, match_type, match_value, target_category_slug, priority, confidence,
  auto_approval_allowed
) AS (VALUES
    ('ELECTRICAL_ALTERNATOR_A_EPC15_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '15', 'TYPE_CODE', 'ELECTRICAL_ALTERNATOR', 'electrical-alternators', 100, 'HIGH', TRUE),
    ('ELECTRICAL_ALTERNATOR_A_EPC98_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '98', 'TYPE_CODE', 'ELECTRICAL_ALTERNATOR', 'electrical-alternators', 100, 'HIGH', TRUE),
    ('ELECTRICAL_ANTENNA_A_EPC82_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'ELECTRICAL_ANTENNA', 'electrical-antennas', 100, 'HIGH', TRUE),
    ('ELECTRICAL_ANTENNA_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_ANTENNA', 'electrical-antennas', 100, 'HIGH', TRUE),
    ('ELECTRICAL_BATTERY_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_BATTERY', 'electrical-batteries', 100, 'HIGH', TRUE),
    ('ELECTRICAL_BATTERY_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_BATTERY', 'electrical-batteries', 100, 'HIGH', TRUE),
    ('ELECTRICAL_BATTERY_A_EPC98_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '98', 'TYPE_CODE', 'ELECTRICAL_BATTERY', 'electrical-batteries', 100, 'HIGH', TRUE),
    ('ELECTRICAL_CAMERA_A_EPC82_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'ELECTRICAL_CAMERA', 'electrical-cameras', 100, 'HIGH', TRUE),
    ('ELECTRICAL_CAMERA_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_CAMERA', 'electrical-cameras', 100, 'HIGH', TRUE),
    ('ELECTRICAL_CONNECTOR_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_CONNECTOR', 'electrical-connectors-plugs', 100, 'HIGH', TRUE),
    ('ELECTRICAL_CONTROL_UNIT_A_EPC15_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '15', 'TYPE_CODE', 'ELECTRICAL_CONTROL_UNIT', 'electrical-control-units', 100, 'HIGH', TRUE),
    ('ELECTRICAL_CONTROL_UNIT_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_CONTROL_UNIT', 'electrical-control-units', 100, 'HIGH', TRUE),
    ('ELECTRICAL_CONTROL_UNIT_A_EPC82_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'ELECTRICAL_CONTROL_UNIT', 'electrical-control-units', 100, 'HIGH', TRUE),
    ('ELECTRICAL_CONTROL_UNIT_A_EPC87_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '87', 'TYPE_CODE', 'ELECTRICAL_CONTROL_UNIT', 'electrical-control-units', 100, 'HIGH', TRUE),
    ('ELECTRICAL_CONTROL_UNIT_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_CONTROL_UNIT', 'electrical-control-units', 100, 'HIGH', TRUE),
    ('ELECTRICAL_DRIVER_ASSISTANCE_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_DRIVER_ASSISTANCE', 'electrical-driver-assistance', 100, 'HIGH', TRUE),
    ('ELECTRICAL_DRIVER_ASSISTANCE_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_DRIVER_ASSISTANCE', 'electrical-driver-assistance', 100, 'HIGH', TRUE),
    ('ELECTRICAL_FUSE_BOX_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_FUSE_BOX', 'electrical-fuse-boxes', 100, 'HIGH', TRUE),
    ('ELECTRICAL_FUSE_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_FUSE', 'electrical-fuses', 100, 'HIGH', TRUE),
    ('ELECTRICAL_FUSE_A_EPC82_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'ELECTRICAL_FUSE', 'electrical-fuses', 100, 'HIGH', TRUE),
    ('ELECTRICAL_FUSE_A_EPC98_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '98', 'TYPE_CODE', 'ELECTRICAL_FUSE', 'electrical-fuses', 100, 'HIGH', TRUE),
    ('ELECTRICAL_INFOTAINMENT_A_EPC82_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'ELECTRICAL_INFOTAINMENT', 'electrical-infotainment', 100, 'HIGH', TRUE),
    ('ELECTRICAL_INFOTAINMENT_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_INFOTAINMENT', 'electrical-infotainment', 100, 'HIGH', TRUE),
    ('ELECTRICAL_PARKING_SENSOR_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_PARKING_SENSOR', 'electrical-parking-sensors', 100, 'HIGH', TRUE),
    ('ELECTRICAL_PARKING_SENSOR_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_PARKING_SENSOR', 'electrical-parking-sensors', 100, 'HIGH', TRUE),
    ('ELECTRICAL_RELAY_A_EPC15_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '15', 'TYPE_CODE', 'ELECTRICAL_RELAY', 'electrical-relays', 100, 'HIGH', TRUE),
    ('ELECTRICAL_RELAY_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_RELAY', 'electrical-relays', 100, 'HIGH', TRUE),
    ('ELECTRICAL_RELAY_A_EPC98_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '98', 'TYPE_CODE', 'ELECTRICAL_RELAY', 'electrical-relays', 100, 'HIGH', TRUE),
    ('ELECTRICAL_SENSOR_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_SENSOR', 'electrical-sensors', 100, 'HIGH', TRUE),
    ('ELECTRICAL_SENSOR_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_SENSOR', 'electrical-sensors', 100, 'HIGH', TRUE),
    ('ELECTRICAL_STARTER_A_EPC15_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '15', 'TYPE_CODE', 'ELECTRICAL_STARTER', 'electrical-starters', 100, 'HIGH', TRUE),
    ('ELECTRICAL_STARTER_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_STARTER', 'electrical-starters', 100, 'HIGH', TRUE),
    ('ELECTRICAL_SWITCH_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_SWITCH', 'electrical-switches-controls', 100, 'HIGH', TRUE),
    ('ELECTRICAL_SWITCH_A_EPC82_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'ELECTRICAL_SWITCH', 'electrical-switches-controls', 100, 'HIGH', TRUE),
    ('ELECTRICAL_SWITCH_A_EPC87_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '87', 'TYPE_CODE', 'ELECTRICAL_SWITCH', 'electrical-switches-controls', 100, 'HIGH', TRUE),
    ('ELECTRICAL_SWITCH_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_SWITCH', 'electrical-switches-controls', 100, 'HIGH', TRUE),
    ('ELECTRICAL_SWITCH_A_EPC98_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '98', 'TYPE_CODE', 'ELECTRICAL_SWITCH', 'electrical-switches-controls', 100, 'HIGH', TRUE),
    ('ELECTRICAL_WIRING_HARNESS_A_EPC15_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '15', 'TYPE_CODE', 'ELECTRICAL_WIRING_HARNESS', 'electrical-wiring-harnesses', 100, 'HIGH', TRUE),
    ('ELECTRICAL_WIRING_HARNESS_A_EPC44_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '44', 'TYPE_CODE', 'ELECTRICAL_WIRING_HARNESS', 'electrical-wiring-harnesses', 100, 'HIGH', TRUE),
    ('ELECTRICAL_WIRING_HARNESS_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'ELECTRICAL_WIRING_HARNESS', 'electrical-wiring-harnesses', 100, 'HIGH', TRUE),
    ('ELECTRICAL_WIRING_HARNESS_A_EPC82_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'ELECTRICAL_WIRING_HARNESS', 'electrical-wiring-harnesses', 100, 'HIGH', TRUE),
    ('ELECTRICAL_WIRING_HARNESS_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'ELECTRICAL_WIRING_HARNESS', 'electrical-wiring-harnesses', 100, 'HIGH', TRUE),
    ('LIGHTING_BULB_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'LIGHTING_BULB', 'lighting-bulbs', 100, 'HIGH', TRUE),
    ('LIGHTING_BULB_A_EPC82_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'LIGHTING_BULB', 'lighting-bulbs', 100, 'HIGH', TRUE),
    ('LIGHTING_FOG_LIGHT_A_EPC82_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'LIGHTING_FOG_LIGHT', 'lighting-fog-lights', 100, 'HIGH', TRUE),
    ('LIGHTING_HEADLIGHT_A_EPC54_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'LIGHTING_HEADLIGHT', 'lighting-headlights', 100, 'HIGH', TRUE),
    ('LIGHTING_HEADLIGHT_A_EPC82_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'LIGHTING_HEADLIGHT', 'lighting-headlights', 100, 'HIGH', TRUE),
    ('LIGHTING_HEADLIGHT_A_EPC90_PHASE2G2_V1', 1, 8, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'LIGHTING_HEADLIGHT', 'lighting-headlights', 100, 'HIGH', TRUE)
), resolved AS (
  SELECT seed.*, category.id AS target_category_id
  FROM rule_seed seed
  JOIN customer_categories category ON category.slug = seed.target_category_slug
   AND category.status = 'ACTIVE' AND category.is_active = TRUE
)
INSERT INTO customer_classification_rules(
  code, version, detector_version, source_kind, assignment_role, number_family,
  epc_group, match_type, match_value, target_category_id, priority, confidence,
  auto_approval_allowed, is_active
)
SELECT code, version, detector_version, source_kind, assignment_role, number_family,
  epc_group, match_type, match_value, target_category_id, priority, confidence,
  auto_approval_allowed, FALSE
FROM resolved
ON CONFLICT(code, version) DO UPDATE SET
  detector_version = EXCLUDED.detector_version, source_kind = EXCLUDED.source_kind,
  assignment_role = EXCLUDED.assignment_role, number_family = EXCLUDED.number_family,
  epc_group = EXCLUDED.epc_group, match_type = EXCLUDED.match_type,
  match_value = EXCLUDED.match_value, exclude_values = '{}'::TEXT[],
  target_category_id = EXCLUDED.target_category_id, priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence, auto_approval_allowed = EXCLUDED.auto_approval_allowed,
  updated_at = NOW();

UPDATE customer_classification_rules current SET is_active = TRUE, updated_at = NOW()
WHERE current.detector_version = 8
  AND current.version = (SELECT MAX(candidate.version)
    FROM customer_classification_rules candidate
    WHERE candidate.code = current.code AND candidate.detector_version = 8)
  AND NOT EXISTS (SELECT 1 FROM customer_classification_rules newer
    WHERE newer.code = current.code AND newer.detector_version > 8);

DO $$
DECLARE
  expected_historical_v7 CONSTANT INTEGER := 313;
  expected_successors CONSTANT INTEGER := 313;
  expected_phase2g2_rules CONSTANT INTEGER := 48;
  historical_v7 INTEGER; active_successors INTEGER; active_phase2g2_rules INTEGER;
  duplicate_active_codes INTEGER; unsafe_split_epc_rules INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO historical_v7 FROM customer_classification_rules
  WHERE detector_version = 7 AND is_active = FALSE;
  SELECT COUNT(*)::INTEGER INTO active_successors FROM customer_classification_rules successor
  WHERE successor.detector_version = 8 AND successor.is_active = TRUE
    AND EXISTS (SELECT 1 FROM customer_classification_rules historical
      WHERE historical.code = successor.code AND historical.detector_version = 7
        AND historical.version + 1 = successor.version);
  SELECT COUNT(*)::INTEGER INTO active_phase2g2_rules FROM customer_classification_rules
  WHERE detector_version = 8 AND is_active = TRUE
    AND code = ANY(ARRAY[
      'ELECTRICAL_ALTERNATOR_A_EPC15_PHASE2G2_V1',
      'ELECTRICAL_ALTERNATOR_A_EPC98_PHASE2G2_V1',
      'ELECTRICAL_ANTENNA_A_EPC82_PHASE2G2_V1',
      'ELECTRICAL_ANTENNA_A_EPC90_PHASE2G2_V1',
      'ELECTRICAL_BATTERY_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_BATTERY_A_EPC90_PHASE2G2_V1',
      'ELECTRICAL_BATTERY_A_EPC98_PHASE2G2_V1',
      'ELECTRICAL_CAMERA_A_EPC82_PHASE2G2_V1',
      'ELECTRICAL_CAMERA_A_EPC90_PHASE2G2_V1',
      'ELECTRICAL_CONNECTOR_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_CONTROL_UNIT_A_EPC15_PHASE2G2_V1',
      'ELECTRICAL_CONTROL_UNIT_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_CONTROL_UNIT_A_EPC82_PHASE2G2_V1',
      'ELECTRICAL_CONTROL_UNIT_A_EPC87_PHASE2G2_V1',
      'ELECTRICAL_CONTROL_UNIT_A_EPC90_PHASE2G2_V1',
      'ELECTRICAL_DRIVER_ASSISTANCE_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_DRIVER_ASSISTANCE_A_EPC90_PHASE2G2_V1',
      'ELECTRICAL_FUSE_BOX_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_FUSE_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_FUSE_A_EPC82_PHASE2G2_V1',
      'ELECTRICAL_FUSE_A_EPC98_PHASE2G2_V1',
      'ELECTRICAL_INFOTAINMENT_A_EPC82_PHASE2G2_V1',
      'ELECTRICAL_INFOTAINMENT_A_EPC90_PHASE2G2_V1',
      'ELECTRICAL_PARKING_SENSOR_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_PARKING_SENSOR_A_EPC90_PHASE2G2_V1',
      'ELECTRICAL_RELAY_A_EPC15_PHASE2G2_V1',
      'ELECTRICAL_RELAY_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_RELAY_A_EPC98_PHASE2G2_V1',
      'ELECTRICAL_SENSOR_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_SENSOR_A_EPC90_PHASE2G2_V1',
      'ELECTRICAL_STARTER_A_EPC15_PHASE2G2_V1',
      'ELECTRICAL_STARTER_A_EPC90_PHASE2G2_V1',
      'ELECTRICAL_SWITCH_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_SWITCH_A_EPC82_PHASE2G2_V1',
      'ELECTRICAL_SWITCH_A_EPC87_PHASE2G2_V1',
      'ELECTRICAL_SWITCH_A_EPC90_PHASE2G2_V1',
      'ELECTRICAL_SWITCH_A_EPC98_PHASE2G2_V1',
      'ELECTRICAL_WIRING_HARNESS_A_EPC15_PHASE2G2_V1',
      'ELECTRICAL_WIRING_HARNESS_A_EPC44_PHASE2G2_V1',
      'ELECTRICAL_WIRING_HARNESS_A_EPC54_PHASE2G2_V1',
      'ELECTRICAL_WIRING_HARNESS_A_EPC82_PHASE2G2_V1',
      'ELECTRICAL_WIRING_HARNESS_A_EPC90_PHASE2G2_V1',
      'LIGHTING_BULB_A_EPC54_PHASE2G2_V1',
      'LIGHTING_BULB_A_EPC82_PHASE2G2_V1',
      'LIGHTING_FOG_LIGHT_A_EPC82_PHASE2G2_V1',
      'LIGHTING_HEADLIGHT_A_EPC54_PHASE2G2_V1',
      'LIGHTING_HEADLIGHT_A_EPC82_PHASE2G2_V1',
      'LIGHTING_HEADLIGHT_A_EPC90_PHASE2G2_V1'
    ]::TEXT[]);
  SELECT COUNT(*)::INTEGER INTO duplicate_active_codes FROM (
    SELECT code FROM customer_classification_rules WHERE is_active = TRUE
    GROUP BY code HAVING COUNT(*) > 1
  ) duplicate;
  SELECT COUNT(*)::INTEGER INTO unsafe_split_epc_rules FROM customer_classification_rules
  WHERE detector_version = 8 AND is_active = TRUE
    AND epc_group = ANY(ARRAY['15', '44', '54', '82', '87', '90', '98']::TEXT[]) AND match_type = 'EPC_ONLY';
  IF historical_v7 <> expected_historical_v7 THEN
    RAISE EXCEPTION 'Expected % historical detector-v7 rules, found %', expected_historical_v7, historical_v7;
  END IF;
  IF active_successors <> expected_successors THEN
    RAISE EXCEPTION 'Expected % active detector-v8 successors, found %', expected_successors, active_successors;
  END IF;
  IF active_phase2g2_rules <> expected_phase2g2_rules THEN
    RAISE EXCEPTION 'Expected % active PHASE 2G.2 rules, found %', expected_phase2g2_rules, active_phase2g2_rules;
  END IF;
  IF duplicate_active_codes <> 0 THEN
    RAISE EXCEPTION 'Found % codes with multiple active versions', duplicate_active_codes;
  END IF;
  IF unsafe_split_epc_rules <> 0 THEN
    RAISE EXCEPTION 'Found % unsafe whole-group rules for mixed PHASE 2G.2 EPC groups', unsafe_split_epc_rules;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version) VALUES ('100_seed_customer_taxonomy_phase2g2_electrical_rules')
ON CONFLICT(version) DO NOTHING;

COMMIT;
