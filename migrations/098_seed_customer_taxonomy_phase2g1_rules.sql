BEGIN;

-- Detector v7 preserves every v6 rule row for historical memberships and
-- publishes one successor for new classifications. No membership is written.
INSERT INTO customer_classification_rules(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value, exclude_values,
  target_category_id, priority, confidence, auto_approval_allowed, is_active
)
SELECT previous.code, previous.version + 1, 7, previous.source_kind,
  previous.assignment_role, previous.number_family, previous.epc_group,
  previous.match_type, previous.match_value, previous.exclude_values,
  previous.target_category_id, previous.priority, previous.confidence,
  previous.auto_approval_allowed, FALSE
FROM customer_classification_rules previous
WHERE previous.detector_version = 6
  AND previous.version = (
    SELECT MAX(candidate.version) FROM customer_classification_rules candidate
    WHERE candidate.code = previous.code AND candidate.detector_version = 6
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_classification_rules newer
    WHERE newer.code = previous.code AND newer.detector_version > 6
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
WHERE detector_version = 6 AND is_active = TRUE;

WITH rule_seed(
  code, version, detector_version, source_kind, assignment_role, number_family,
  epc_group, match_type, match_value, target_category_slug, priority, confidence,
  auto_approval_allowed
) AS (VALUES
    ('BODY_BUMPER_A_EPC62_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '62', 'TYPE_CODE', 'BODY_BUMPER', 'body-bumpers', 100, 'HIGH', TRUE),
    ('BODY_BUMPER_A_EPC88_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '88', 'TYPE_CODE', 'BODY_BUMPER', 'body-bumpers', 100, 'HIGH', TRUE),
    ('BODY_BUMPER_MOUNT_A_EPC62_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '62', 'TYPE_CODE', 'BODY_BUMPER_MOUNT', 'body-bumper-mounts', 100, 'HIGH', TRUE),
    ('BODY_BUMPER_MOUNT_A_EPC88_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '88', 'TYPE_CODE', 'BODY_BUMPER_MOUNT', 'body-bumper-mounts', 100, 'HIGH', TRUE),
    ('BODY_DOOR_HANDLE_A_EPC76_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '76', 'TYPE_CODE', 'BODY_DOOR_HANDLE', 'body-door-handles', 100, 'HIGH', TRUE),
    ('BODY_DOOR_HINGE_A_EPC72_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '72', 'TYPE_CODE', 'BODY_DOOR_HINGE', 'body-door-hinges', 100, 'HIGH', TRUE),
    ('BODY_DOOR_HINGE_A_EPC73_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '73', 'TYPE_CODE', 'BODY_DOOR_HINGE', 'body-door-hinges', 100, 'HIGH', TRUE),
    ('BODY_EMBLEM_A_EPC81_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '81', 'TYPE_CODE', 'BODY_EMBLEM', 'body-emblems', 100, 'HIGH', TRUE),
    ('BODY_EMBLEM_A_EPC88_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '88', 'TYPE_CODE', 'BODY_EMBLEM', 'body-emblems', 100, 'HIGH', TRUE),
    ('BODY_EXTERIOR_MIRROR_A_EPC81_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '81', 'TYPE_CODE', 'BODY_EXTERIOR_MIRROR', 'body-exterior-mirrors', 100, 'HIGH', TRUE),
    ('BODY_EXTERIOR_PANEL_A_EPC61_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '61', 'TYPE_CODE', 'BODY_EXTERIOR_PANEL', 'body-exterior-panels', 100, 'HIGH', TRUE),
    ('BODY_EXTERIOR_PANEL_A_EPC62_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '62', 'TYPE_CODE', 'BODY_EXTERIOR_PANEL', 'body-exterior-panels', 100, 'HIGH', TRUE),
    ('BODY_EXTERIOR_PANEL_A_EPC69_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '69', 'TYPE_CODE', 'BODY_EXTERIOR_PANEL', 'body-exterior-panels', 100, 'HIGH', TRUE),
    ('BODY_EXTERIOR_TRIM_A_EPC69_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '69', 'TYPE_CODE', 'BODY_EXTERIOR_TRIM', 'body-mouldings-trims', 100, 'HIGH', TRUE),
    ('BODY_EXTERIOR_TRIM_A_EPC74_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '74', 'TYPE_CODE', 'BODY_EXTERIOR_TRIM', 'body-mouldings-trims', 100, 'HIGH', TRUE),
    ('BODY_EXTERIOR_TRIM_A_EPC78_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '78', 'TYPE_CODE', 'BODY_EXTERIOR_TRIM', 'body-mouldings-trims', 100, 'HIGH', TRUE),
    ('BODY_EXTERIOR_TRIM_A_EPC88_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '88', 'TYPE_CODE', 'BODY_EXTERIOR_TRIM', 'body-mouldings-trims', 100, 'HIGH', TRUE),
    ('BODY_FENDER_A_EPC69_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '69', 'TYPE_CODE', 'BODY_FENDER', 'body-fenders', 100, 'HIGH', TRUE),
    ('BODY_FENDER_A_EPC81_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '81', 'TYPE_CODE', 'BODY_FENDER', 'body-fenders', 100, 'HIGH', TRUE),
    ('BODY_FENDER_A_EPC88_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '88', 'TYPE_CODE', 'BODY_FENDER', 'body-fenders', 100, 'HIGH', TRUE),
    ('BODY_GRILLE_A_EPC81_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '81', 'TYPE_CODE', 'BODY_GRILLE', 'body-grilles', 100, 'HIGH', TRUE),
    ('BODY_GRILLE_A_EPC88_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '88', 'TYPE_CODE', 'BODY_GRILLE', 'body-grilles', 100, 'HIGH', TRUE),
    ('BODY_HOOD_A_EPC75_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '75', 'TYPE_CODE', 'BODY_HOOD', 'body-hoods', 100, 'HIGH', TRUE),
    ('BODY_HOOD_A_EPC81_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '81', 'TYPE_CODE', 'BODY_HOOD', 'body-hoods', 100, 'HIGH', TRUE),
    ('BODY_HOOD_A_EPC88_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '88', 'TYPE_CODE', 'BODY_HOOD', 'body-hoods', 100, 'HIGH', TRUE),
    ('BODY_LOCK_LATCH_A_EPC72_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '72', 'TYPE_CODE', 'BODY_LOCK_LATCH', 'body-locks-latches', 100, 'HIGH', TRUE),
    ('BODY_LOCK_LATCH_A_EPC73_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '73', 'TYPE_CODE', 'BODY_LOCK_LATCH', 'body-locks-latches', 100, 'HIGH', TRUE),
    ('BODY_LOCK_LATCH_A_EPC74_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '74', 'TYPE_CODE', 'BODY_LOCK_LATCH', 'body-locks-latches', 100, 'HIGH', TRUE),
    ('BODY_LOCK_LATCH_A_EPC75_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '75', 'TYPE_CODE', 'BODY_LOCK_LATCH', 'body-locks-latches', 100, 'HIGH', TRUE),
    ('BODY_LOCK_LATCH_A_EPC76_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '76', 'TYPE_CODE', 'BODY_LOCK_LATCH', 'body-locks-latches', 100, 'HIGH', TRUE),
    ('BODY_MIRROR_PART_A_EPC81_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '81', 'TYPE_CODE', 'BODY_MIRROR_PART', 'body-mirror-parts', 100, 'HIGH', TRUE),
    ('BODY_ROOF_PART_A_EPC69_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '69', 'TYPE_CODE', 'BODY_ROOF_PART', 'body-roof-parts', 100, 'HIGH', TRUE),
    ('BODY_ROOF_PART_A_EPC78_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '78', 'TYPE_CODE', 'BODY_ROOF_PART', 'body-roof-parts', 100, 'HIGH', TRUE),
    ('BODY_TAILGATE_TRUNK_LID_A_EPC74_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '74', 'TYPE_CODE', 'BODY_TAILGATE_TRUNK_LID', 'body-tailgates-trunk-lids', 100, 'HIGH', TRUE),
    ('BODY_TAILGATE_TRUNK_LID_A_EPC75_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '75', 'TYPE_CODE', 'BODY_TAILGATE_TRUNK_LID', 'body-tailgates-trunk-lids', 100, 'HIGH', TRUE),
    ('BODY_TAILGATE_TRUNK_LID_A_EPC79_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '79', 'TYPE_CODE', 'BODY_TAILGATE_TRUNK_LID', 'body-tailgates-trunk-lids', 100, 'HIGH', TRUE),
    ('BODY_TAILGATE_TRUNK_LID_A_EPC81_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '81', 'TYPE_CODE', 'BODY_TAILGATE_TRUNK_LID', 'body-tailgates-trunk-lids', 100, 'HIGH', TRUE),
    ('BODY_UNDERBODY_SHIELD_A_EPC52_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '52', 'TYPE_CODE', 'BODY_UNDERBODY_SHIELD', 'body-underbody-shields', 100, 'HIGH', TRUE),
    ('BODY_WHEEL_ARCH_LINER_A_EPC69_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '69', 'TYPE_CODE', 'BODY_WHEEL_ARCH_LINER', 'body-wheel-arch-liners', 100, 'HIGH', TRUE),
    ('GLASS_SIDE_WINDOW_A_EPC69_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '69', 'TYPE_CODE', 'GLASS_SIDE_WINDOW', 'body-side-windows', 100, 'HIGH', TRUE),
    ('GLASS_SIDE_WINDOW_A_EPC72_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '72', 'TYPE_CODE', 'GLASS_SIDE_WINDOW', 'body-side-windows', 100, 'HIGH', TRUE),
    ('GLASS_SIDE_WINDOW_A_EPC73_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '73', 'TYPE_CODE', 'GLASS_SIDE_WINDOW', 'body-side-windows', 100, 'HIGH', TRUE),
    ('INTERIOR_PEDAL_A_EPC29_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '29', 'TYPE_CODE', 'INTERIOR_PEDAL', 'interior-pedals', 100, 'HIGH', TRUE),
    ('INTERIOR_PEDAL_A_EPC30_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '30', 'TYPE_CODE', 'INTERIOR_PEDAL', 'interior-pedals', 100, 'HIGH', TRUE),
    ('INTERIOR_SEAT_A_EPC91_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '91', 'TYPE_CODE', 'INTERIOR_SEAT', 'interior-seats', 100, 'HIGH', TRUE),
    ('INTERIOR_SEAT_A_EPC92_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '92', 'TYPE_CODE', 'INTERIOR_SEAT', 'interior-seats', 100, 'HIGH', TRUE),
    ('INTERIOR_SEAT_A_EPC93_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '93', 'TYPE_CODE', 'INTERIOR_SEAT', 'interior-seats', 100, 'HIGH', TRUE),
    ('INTERIOR_SEAT_MECHANISM_A_EPC91_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '91', 'TYPE_CODE', 'INTERIOR_SEAT_MECHANISM', 'interior-seat-mechanisms', 100, 'HIGH', TRUE),
    ('INTERIOR_SEAT_MECHANISM_A_EPC92_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '92', 'TYPE_CODE', 'INTERIOR_SEAT_MECHANISM', 'interior-seat-mechanisms', 100, 'HIGH', TRUE),
    ('INTERIOR_SEAT_MECHANISM_A_EPC93_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '93', 'TYPE_CODE', 'INTERIOR_SEAT_MECHANISM', 'interior-seat-mechanisms', 100, 'HIGH', TRUE),
    ('INTERIOR_TRIM_PANEL_A_EPC68_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '68', 'TYPE_CODE', 'INTERIOR_TRIM_PANEL', 'interior-trim-panels', 100, 'HIGH', TRUE),
    ('INTERIOR_TRIM_PANEL_A_EPC91_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '91', 'TYPE_CODE', 'INTERIOR_TRIM_PANEL', 'interior-trim-panels', 100, 'HIGH', TRUE),
    ('SAFETY_AIRBAG_A_EPC86_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '86', 'TYPE_CODE', 'SAFETY_AIRBAG', 'safety-airbags', 100, 'HIGH', TRUE),
    ('SAFETY_RESTRAINT_COMPONENT_A_EPC86_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '86', 'TYPE_CODE', 'SAFETY_RESTRAINT_COMPONENT', 'safety-restraint-components', 100, 'HIGH', TRUE),
    ('SAFETY_RESTRAINT_COMPONENT_A_EPC91_PHASE2G1_V1', 1, 7, 'RULE', 'PRIMARY', 'A', '91', 'TYPE_CODE', 'SAFETY_RESTRAINT_COMPONENT', 'safety-restraint-components', 100, 'HIGH', TRUE)
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
WHERE current.detector_version = 7
  AND current.version = (SELECT MAX(candidate.version)
    FROM customer_classification_rules candidate
    WHERE candidate.code = current.code AND candidate.detector_version = 7)
  AND NOT EXISTS (SELECT 1 FROM customer_classification_rules newer
    WHERE newer.code = current.code AND newer.detector_version > 7);

DO $$
DECLARE
  expected_historical_v6 CONSTANT INTEGER := 258;
  expected_successors CONSTANT INTEGER := 258;
  expected_phase2g1_rules CONSTANT INTEGER := 55;
  historical_v6 INTEGER; active_successors INTEGER; active_phase2g1_rules INTEGER;
  duplicate_active_codes INTEGER; unsafe_split_epc_rules INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO historical_v6 FROM customer_classification_rules
  WHERE detector_version = 6 AND is_active = FALSE;
  SELECT COUNT(*)::INTEGER INTO active_successors FROM customer_classification_rules successor
  WHERE successor.detector_version = 7 AND successor.is_active = TRUE
    AND EXISTS (SELECT 1 FROM customer_classification_rules historical
      WHERE historical.code = successor.code AND historical.detector_version = 6
        AND historical.version + 1 = successor.version);
  SELECT COUNT(*)::INTEGER INTO active_phase2g1_rules FROM customer_classification_rules
  WHERE detector_version = 7 AND is_active = TRUE
    AND code = ANY(ARRAY[
      'BODY_BUMPER_A_EPC62_PHASE2G1_V1',
      'BODY_BUMPER_A_EPC88_PHASE2G1_V1',
      'BODY_BUMPER_MOUNT_A_EPC62_PHASE2G1_V1',
      'BODY_BUMPER_MOUNT_A_EPC88_PHASE2G1_V1',
      'BODY_DOOR_HANDLE_A_EPC76_PHASE2G1_V1',
      'BODY_DOOR_HINGE_A_EPC72_PHASE2G1_V1',
      'BODY_DOOR_HINGE_A_EPC73_PHASE2G1_V1',
      'BODY_EMBLEM_A_EPC81_PHASE2G1_V1',
      'BODY_EMBLEM_A_EPC88_PHASE2G1_V1',
      'BODY_EXTERIOR_MIRROR_A_EPC81_PHASE2G1_V1',
      'BODY_EXTERIOR_PANEL_A_EPC61_PHASE2G1_V1',
      'BODY_EXTERIOR_PANEL_A_EPC62_PHASE2G1_V1',
      'BODY_EXTERIOR_PANEL_A_EPC69_PHASE2G1_V1',
      'BODY_EXTERIOR_TRIM_A_EPC69_PHASE2G1_V1',
      'BODY_EXTERIOR_TRIM_A_EPC74_PHASE2G1_V1',
      'BODY_EXTERIOR_TRIM_A_EPC78_PHASE2G1_V1',
      'BODY_EXTERIOR_TRIM_A_EPC88_PHASE2G1_V1',
      'BODY_FENDER_A_EPC69_PHASE2G1_V1',
      'BODY_FENDER_A_EPC81_PHASE2G1_V1',
      'BODY_FENDER_A_EPC88_PHASE2G1_V1',
      'BODY_GRILLE_A_EPC81_PHASE2G1_V1',
      'BODY_GRILLE_A_EPC88_PHASE2G1_V1',
      'BODY_HOOD_A_EPC75_PHASE2G1_V1',
      'BODY_HOOD_A_EPC81_PHASE2G1_V1',
      'BODY_HOOD_A_EPC88_PHASE2G1_V1',
      'BODY_LOCK_LATCH_A_EPC72_PHASE2G1_V1',
      'BODY_LOCK_LATCH_A_EPC73_PHASE2G1_V1',
      'BODY_LOCK_LATCH_A_EPC74_PHASE2G1_V1',
      'BODY_LOCK_LATCH_A_EPC75_PHASE2G1_V1',
      'BODY_LOCK_LATCH_A_EPC76_PHASE2G1_V1',
      'BODY_MIRROR_PART_A_EPC81_PHASE2G1_V1',
      'BODY_ROOF_PART_A_EPC69_PHASE2G1_V1',
      'BODY_ROOF_PART_A_EPC78_PHASE2G1_V1',
      'BODY_TAILGATE_TRUNK_LID_A_EPC74_PHASE2G1_V1',
      'BODY_TAILGATE_TRUNK_LID_A_EPC75_PHASE2G1_V1',
      'BODY_TAILGATE_TRUNK_LID_A_EPC79_PHASE2G1_V1',
      'BODY_TAILGATE_TRUNK_LID_A_EPC81_PHASE2G1_V1',
      'BODY_UNDERBODY_SHIELD_A_EPC52_PHASE2G1_V1',
      'BODY_WHEEL_ARCH_LINER_A_EPC69_PHASE2G1_V1',
      'GLASS_SIDE_WINDOW_A_EPC69_PHASE2G1_V1',
      'GLASS_SIDE_WINDOW_A_EPC72_PHASE2G1_V1',
      'GLASS_SIDE_WINDOW_A_EPC73_PHASE2G1_V1',
      'INTERIOR_PEDAL_A_EPC29_PHASE2G1_V1',
      'INTERIOR_PEDAL_A_EPC30_PHASE2G1_V1',
      'INTERIOR_SEAT_A_EPC91_PHASE2G1_V1',
      'INTERIOR_SEAT_A_EPC92_PHASE2G1_V1',
      'INTERIOR_SEAT_A_EPC93_PHASE2G1_V1',
      'INTERIOR_SEAT_MECHANISM_A_EPC91_PHASE2G1_V1',
      'INTERIOR_SEAT_MECHANISM_A_EPC92_PHASE2G1_V1',
      'INTERIOR_SEAT_MECHANISM_A_EPC93_PHASE2G1_V1',
      'INTERIOR_TRIM_PANEL_A_EPC68_PHASE2G1_V1',
      'INTERIOR_TRIM_PANEL_A_EPC91_PHASE2G1_V1',
      'SAFETY_AIRBAG_A_EPC86_PHASE2G1_V1',
      'SAFETY_RESTRAINT_COMPONENT_A_EPC86_PHASE2G1_V1',
      'SAFETY_RESTRAINT_COMPONENT_A_EPC91_PHASE2G1_V1'
    ]::TEXT[]);
  SELECT COUNT(*)::INTEGER INTO duplicate_active_codes FROM (
    SELECT code FROM customer_classification_rules WHERE is_active = TRUE
    GROUP BY code HAVING COUNT(*) > 1
  ) duplicate;
  SELECT COUNT(*)::INTEGER INTO unsafe_split_epc_rules FROM customer_classification_rules
  WHERE detector_version = 7 AND is_active = TRUE
    AND epc_group = ANY(ARRAY['29', '30', '52', '61', '62', '68', '69', '72', '73', '74', '75', '76', '78', '79', '81', '86', '88', '91', '92', '93']::TEXT[]) AND match_type = 'EPC_ONLY';
  IF historical_v6 <> expected_historical_v6 THEN
    RAISE EXCEPTION 'Expected % historical detector-v6 rules, found %', expected_historical_v6, historical_v6;
  END IF;
  IF active_successors <> expected_successors THEN
    RAISE EXCEPTION 'Expected % active detector-v7 successors, found %', expected_successors, active_successors;
  END IF;
  IF active_phase2g1_rules <> expected_phase2g1_rules THEN
    RAISE EXCEPTION 'Expected % active PHASE 2G.1 rules, found %', expected_phase2g1_rules, active_phase2g1_rules;
  END IF;
  IF duplicate_active_codes <> 0 THEN
    RAISE EXCEPTION 'Found % codes with multiple active versions', duplicate_active_codes;
  END IF;
  IF unsafe_split_epc_rules <> 0 THEN
    RAISE EXCEPTION 'Found % unsafe whole-group rules for split PHASE 2G.1 EPC groups', unsafe_split_epc_rules;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version) VALUES ('098_seed_customer_taxonomy_phase2g1_rules')
ON CONFLICT(version) DO NOTHING;

COMMIT;
