BEGIN;

-- Detector v9 preserves every v8 rule row for historical memberships and
-- publishes one field-identical successor for new classifications.
-- No membership is written by this migration.
INSERT INTO customer_classification_rules(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value, exclude_values,
  target_category_id, priority, confidence, auto_approval_allowed, is_active
)
SELECT previous.code, previous.version + 1, 9, previous.source_kind,
  previous.assignment_role, previous.number_family, previous.epc_group,
  previous.match_type, previous.match_value, previous.exclude_values,
  previous.target_category_id, previous.priority, previous.confidence,
  previous.auto_approval_allowed, FALSE
FROM customer_classification_rules previous
WHERE previous.detector_version = 8
  AND previous.version = (
    SELECT MAX(candidate.version) FROM customer_classification_rules candidate
    WHERE candidate.code = previous.code AND candidate.detector_version = 8
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_classification_rules newer
    WHERE newer.code = previous.code AND newer.detector_version > 8
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
WHERE detector_version = 8 AND is_active = TRUE;

WITH rule_seed(
  code, version, detector_version, source_kind, assignment_role, number_family,
  epc_group, match_type, match_value, target_category_slug, priority, confidence,
  auto_approval_allowed
) AS (VALUES
    ('FASTENER_BOLT_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'FASTENER_BOLT', 'fasteners-bolts', 100, 'HIGH', TRUE),
    ('STANDARD_SEAL_GASKET_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'STANDARD_SEAL_GASKET', 'fasteners-seals-gaskets', 100, 'HIGH', TRUE),
    ('FASTENER_SCREW_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'FASTENER_SCREW', 'fasteners-screws', 100, 'HIGH', TRUE),
    ('FASTENER_NUT_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'FASTENER_NUT', 'fasteners-nuts', 100, 'HIGH', TRUE),
    ('FASTENER_CLAMP_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'FASTENER_CLAMP', 'fasteners-clamps', 100, 'HIGH', TRUE),
    ('FASTENER_CLIP_RIVET_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'FASTENER_CLIP_RIVET', 'fasteners-clips-rivets', 100, 'HIGH', TRUE),
    ('STANDARD_PLUG_CAP_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'STANDARD_PLUG_CAP', 'fasteners-plugs-caps', 100, 'HIGH', TRUE),
    ('FASTENER_WASHER_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'FASTENER_WASHER', 'fasteners-washers', 100, 'HIGH', TRUE),
    ('STANDARD_GROMMET_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'STANDARD_GROMMET', 'fasteners-grommets', 100, 'HIGH', TRUE),
    ('STANDARD_SEALING_RING_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'STANDARD_SEALING_RING', 'fasteners-sealing-rings', 100, 'HIGH', TRUE),
    ('FASTENER_PIN_CIRCLIP_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'FASTENER_PIN_CIRCLIP', 'fasteners-pins-circlips', 100, 'HIGH', TRUE),
    ('FASTENER_STUD_PHASE2G3_V1', 1, 9, 'RULE', 'PRIMARY', NULL, NULL, 'TYPE_CODE', 'FASTENER_STUD', 'fasteners-studs', 100, 'HIGH', TRUE)
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
WHERE current.detector_version = 9
  AND current.version = (SELECT MAX(candidate.version)
    FROM customer_classification_rules candidate
    WHERE candidate.code = current.code AND candidate.detector_version = 9)
  AND NOT EXISTS (SELECT 1 FROM customer_classification_rules newer
    WHERE newer.code = current.code AND newer.detector_version > 9);

DO $$
DECLARE
  expected_historical_v8 CONSTANT INTEGER := 361;
  expected_successors CONSTANT INTEGER := 361;
  expected_phase2g3_rules CONSTANT INTEGER := 12;
  historical_v8 INTEGER;
  active_successors INTEGER;
  active_phase2g3_rules INTEGER;
  duplicate_active_codes INTEGER;
  unsafe_epc_rules INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO historical_v8
  FROM customer_classification_rules
  WHERE detector_version = 8 AND is_active = FALSE;

  SELECT COUNT(*)::INTEGER INTO active_successors
  FROM customer_classification_rules successor
  WHERE successor.detector_version = 9 AND successor.is_active = TRUE
    AND EXISTS (SELECT 1 FROM customer_classification_rules historical
      WHERE historical.code = successor.code AND historical.detector_version = 8
        AND historical.version + 1 = successor.version);

  SELECT COUNT(*)::INTEGER INTO active_phase2g3_rules
  FROM customer_classification_rules
  WHERE detector_version = 9 AND is_active = TRUE
    AND code = ANY(ARRAY[
      'FASTENER_BOLT_PHASE2G3_V1',
      'STANDARD_SEAL_GASKET_PHASE2G3_V1',
      'FASTENER_SCREW_PHASE2G3_V1',
      'FASTENER_NUT_PHASE2G3_V1',
      'FASTENER_CLAMP_PHASE2G3_V1',
      'FASTENER_CLIP_RIVET_PHASE2G3_V1',
      'STANDARD_PLUG_CAP_PHASE2G3_V1',
      'FASTENER_WASHER_PHASE2G3_V1',
      'STANDARD_GROMMET_PHASE2G3_V1',
      'STANDARD_SEALING_RING_PHASE2G3_V1',
      'FASTENER_PIN_CIRCLIP_PHASE2G3_V1',
      'FASTENER_STUD_PHASE2G3_V1'
    ]::TEXT[]);

  SELECT COUNT(*)::INTEGER INTO duplicate_active_codes FROM (
    SELECT code FROM customer_classification_rules WHERE is_active = TRUE
    GROUP BY code HAVING COUNT(*) > 1
  ) duplicate;

  SELECT COUNT(*)::INTEGER INTO unsafe_epc_rules
  FROM customer_classification_rules
  WHERE detector_version = 9 AND is_active = TRUE
    AND epc_group = ANY(ARRAY['98', '99']::TEXT[])
    AND match_type = 'EPC_ONLY';

  IF historical_v8 <> expected_historical_v8 THEN
    RAISE EXCEPTION 'Expected % historical detector-v8 rules, found %', expected_historical_v8, historical_v8;
  END IF;
  IF active_successors <> expected_successors THEN
    RAISE EXCEPTION 'Expected % active detector-v9 successors, found %', expected_successors, active_successors;
  END IF;
  IF active_phase2g3_rules <> expected_phase2g3_rules THEN
    RAISE EXCEPTION 'Expected % active PHASE 2G.3 rules, found %', expected_phase2g3_rules, active_phase2g3_rules;
  END IF;
  IF duplicate_active_codes <> 0 THEN
    RAISE EXCEPTION 'Found % codes with multiple active versions', duplicate_active_codes;
  END IF;
  IF unsafe_epc_rules <> 0 THEN
    RAISE EXCEPTION 'Found % unsafe whole-group PHASE 2G.3 EPC rules', unsafe_epc_rules;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('102_seed_customer_taxonomy_phase2g3_fasteners_rules')
ON CONFLICT(version) DO NOTHING;

COMMIT;
