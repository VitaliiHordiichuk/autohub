BEGIN;

-- Detector v6 extends the closed semantic contract. Preserve every detector-v5
-- row for historical memberships and publish one v6 successor per active
-- logical rule. No membership table is touched by this migration.
INSERT INTO customer_classification_rules(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value, exclude_values,
  target_category_id, priority, confidence, auto_approval_allowed, is_active
)
SELECT
  previous.code,
  previous.version + 1,
  6,
  previous.source_kind,
  previous.assignment_role,
  previous.number_family,
  previous.epc_group,
  previous.match_type,
  previous.match_value,
  previous.exclude_values,
  previous.target_category_id,
  previous.priority,
  previous.confidence,
  previous.auto_approval_allowed,
  FALSE
FROM customer_classification_rules previous
WHERE previous.detector_version = 5
  AND previous.version = (
    SELECT MAX(candidate.version)
    FROM customer_classification_rules candidate
    WHERE candidate.code = previous.code
      AND candidate.detector_version = 5
  )
  AND NOT EXISTS (
    SELECT 1
    FROM customer_classification_rules newer
    WHERE newer.code = previous.code
      AND newer.detector_version > 5
  )
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
  updated_at = NOW();

UPDATE customer_classification_rules
SET is_active = FALSE,
    updated_at = NOW()
WHERE detector_version = 5
  AND is_active = TRUE;

WITH rule_seed(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value,
  target_category_slug, priority, confidence, auto_approval_allowed
) AS (
  VALUES
    ('ENGINE_AIR_FILTER_HOUSING_A_EPC09_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '09', 'TYPE_CODE', 'ENGINE_AIR_FILTER_HOUSING', 'engine-air-filter-housings', 100, 'HIGH', TRUE),
    ('ENGINE_BELT_ROLLER_IDLER_A_EPC20_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '20', 'TYPE_CODE', 'ENGINE_BELT_ROLLER_IDLER', 'engine-belt-rollers-idlers', 100, 'HIGH', TRUE),
    ('ENGINE_BELT_ROLLER_IDLER_A_EPC23_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '23', 'TYPE_CODE', 'ENGINE_BELT_ROLLER_IDLER', 'engine-belt-rollers-idlers', 100, 'HIGH', TRUE),
    ('ENGINE_BELT_TENSIONER_A_EPC20_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '20', 'TYPE_CODE', 'ENGINE_BELT_TENSIONER', 'engine-belt-tensioners', 100, 'HIGH', TRUE),
    ('ENGINE_BLOCK_CRANKSHAFT_PISTON_A_EPC03_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '03', 'TYPE_CODE', 'ENGINE_BLOCK_CRANKSHAFT_PISTON', 'engine-block-crankshaft-pistons', 100, 'HIGH', TRUE),
    ('ENGINE_COVER_CRANKCASE_A_EPC01_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '01', 'TYPE_CODE', 'ENGINE_COVER_CRANKCASE', 'engine-covers-crankcase', 100, 'HIGH', TRUE),
    ('ENGINE_COVER_CRANKCASE_A_EPC22_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '22', 'TYPE_CODE', 'ENGINE_COVER_CRANKCASE', 'engine-covers-crankcase', 100, 'HIGH', TRUE),
    ('ENGINE_CRANKCASE_VENTILATION_A_EPC01_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '01', 'TYPE_CODE', 'ENGINE_CRANKCASE_VENTILATION', 'engine-crankcase-ventilation', 100, 'HIGH', TRUE),
    ('ENGINE_CYLINDER_HEAD_COMPONENT_A_EPC01_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '01', 'TYPE_CODE', 'ENGINE_CYLINDER_HEAD_COMPONENT', 'engine-cylinder-head-components', 100, 'HIGH', TRUE),
    ('ENGINE_DRIVE_PULLEY_A_EPC03_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '03', 'TYPE_CODE', 'ENGINE_DRIVE_PULLEY', 'engine-belt-pulleys', 100, 'HIGH', TRUE),
    ('ENGINE_DRIVE_PULLEY_A_EPC20_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '20', 'TYPE_CODE', 'ENGINE_DRIVE_PULLEY', 'engine-belt-pulleys', 100, 'HIGH', TRUE),
    ('ENGINE_GASKET_SEAL_A_EPC01_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '01', 'TYPE_CODE', 'ENGINE_GASKET_SEAL', 'engine-gaskets-seals', 100, 'HIGH', TRUE),
    ('ENGINE_GASKET_SEAL_A_EPC03_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '03', 'TYPE_CODE', 'ENGINE_GASKET_SEAL', 'engine-gaskets-seals', 100, 'HIGH', TRUE),
    ('ENGINE_GASKET_SEAL_A_EPC05_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '05', 'TYPE_CODE', 'ENGINE_GASKET_SEAL', 'engine-gaskets-seals', 100, 'HIGH', TRUE),
    ('ENGINE_GASKET_SEAL_A_EPC09_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '09', 'TYPE_CODE', 'ENGINE_GASKET_SEAL', 'engine-gaskets-seals', 100, 'HIGH', TRUE),
    ('ENGINE_GASKET_SEAL_A_EPC18_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '18', 'TYPE_CODE', 'ENGINE_GASKET_SEAL', 'engine-gaskets-seals', 100, 'HIGH', TRUE),
    ('ENGINE_INTAKE_AIR_DUCT_A_EPC09_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '09', 'TYPE_CODE', 'ENGINE_INTAKE_AIR_DUCT', 'engine-intake-air-ducts', 100, 'HIGH', TRUE),
    ('ENGINE_INTAKE_MANIFOLD_THROTTLE_A_EPC09_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '09', 'TYPE_CODE', 'ENGINE_INTAKE_MANIFOLD_THROTTLE', 'engine-intake-manifolds-throttle', 100, 'HIGH', TRUE),
    ('ENGINE_INTAKE_MANIFOLD_THROTTLE_A_EPC14_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '14', 'TYPE_CODE', 'ENGINE_INTAKE_MANIFOLD_THROTTLE', 'engine-intake-manifolds-throttle', 100, 'HIGH', TRUE),
    ('ENGINE_MOUNT_A_EPC22_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '22', 'TYPE_CODE', 'ENGINE_MOUNT', 'engine-mounts', 100, 'HIGH', TRUE),
    ('ENGINE_MOUNT_A_EPC24_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '24', 'TYPE_CODE', 'ENGINE_MOUNT', 'engine-mounts', 100, 'HIGH', TRUE),
    ('ENGINE_OIL_LINE_COOLER_A_EPC09_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '09', 'TYPE_CODE', 'ENGINE_OIL_LINE_COOLER', 'engine-oil-lines-coolers', 100, 'HIGH', TRUE),
    ('ENGINE_OIL_LINE_COOLER_A_EPC18_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '18', 'TYPE_CODE', 'ENGINE_OIL_LINE_COOLER', 'engine-oil-lines-coolers', 100, 'HIGH', TRUE),
    ('ENGINE_OIL_PUMP_A_EPC18_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '18', 'TYPE_CODE', 'ENGINE_OIL_PUMP', 'engine-oil-pumps', 100, 'HIGH', TRUE),
    ('ENGINE_OIL_SYSTEM_COMPONENT_A_EPC01_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '01', 'TYPE_CODE', 'ENGINE_OIL_SYSTEM_COMPONENT', 'engine-oil-system-components', 100, 'HIGH', TRUE),
    ('ENGINE_OIL_SYSTEM_COMPONENT_A_EPC18_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '18', 'TYPE_CODE', 'ENGINE_OIL_SYSTEM_COMPONENT', 'engine-oil-system-components', 100, 'HIGH', TRUE),
    ('ENGINE_SENSOR_A_EPC09_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '09', 'TYPE_CODE', 'ENGINE_SENSOR', 'engine-sensors', 100, 'HIGH', TRUE),
    ('ENGINE_TIMING_COMPONENT_A_EPC03_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '03', 'TYPE_CODE', 'ENGINE_TIMING_COMPONENT', 'engine-timing-components', 100, 'HIGH', TRUE),
    ('ENGINE_TIMING_COMPONENT_A_EPC05_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '05', 'TYPE_CODE', 'ENGINE_TIMING_COMPONENT', 'engine-timing-components', 100, 'HIGH', TRUE),
    ('ENGINE_TURBO_CHARGE_AIR_A_EPC09_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '09', 'TYPE_CODE', 'ENGINE_TURBO_CHARGE_AIR', 'engine-turbo-charge-air', 100, 'HIGH', TRUE),
    ('ENGINE_TURBO_CHARGE_AIR_A_EPC14_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '14', 'TYPE_CODE', 'ENGINE_TURBO_CHARGE_AIR', 'engine-turbo-charge-air', 100, 'HIGH', TRUE),
    ('ENGINE_VACUUM_COMPONENT_A_EPC09_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '09', 'TYPE_CODE', 'ENGINE_VACUUM_COMPONENT', 'engine-vacuum-system', 100, 'HIGH', TRUE),
    ('ENGINE_VACUUM_COMPONENT_A_EPC23_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '23', 'TYPE_CODE', 'ENGINE_VACUUM_COMPONENT', 'engine-vacuum-system', 100, 'HIGH', TRUE),
    ('ENGINE_VALVETRAIN_COMPONENT_A_EPC05_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '05', 'TYPE_CODE', 'ENGINE_VALVETRAIN_COMPONENT', 'engine-valvetrain-components', 100, 'HIGH', TRUE),
    ('FILTER_AIR_ENGINE_A_EPC18_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '18', 'TYPE_CODE', 'FILTER_AIR_ENGINE', 'filters-engine-air', 100, 'HIGH', TRUE),
    ('FILTER_AIR_ENGINE_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'FILTER_AIR_ENGINE', 'filters-engine-air', 100, 'HIGH', TRUE),
    ('FILTER_CABIN_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'FILTER_CABIN', 'filters-cabin', 100, 'HIGH', TRUE),
    ('FILTER_FUEL_A_EPC09_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '09', 'TYPE_CODE', 'FILTER_FUEL', 'filters-fuel', 100, 'HIGH', TRUE),
    ('FILTER_OIL_A_EPC01_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '01', 'TYPE_CODE', 'FILTER_OIL', 'filters-oil', 100, 'HIGH', TRUE),
    ('FILTER_OIL_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'FILTER_OIL', 'filters-oil', 100, 'HIGH', TRUE),
    ('SUSPENSION_AIR_COMPONENT_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_AIR_COMPONENT', 'suspension-air-components', 100, 'HIGH', TRUE),
    ('SUSPENSION_BALL_JOINT_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_BALL_JOINT', 'suspension-ball-joints', 100, 'HIGH', TRUE),
    ('SUSPENSION_BALL_JOINT_A_EPC33_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '33', 'TYPE_CODE', 'SUSPENSION_BALL_JOINT', 'suspension-ball-joints', 100, 'HIGH', TRUE),
    ('SUSPENSION_BALL_JOINT_A_EPC35_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '35', 'TYPE_CODE', 'SUSPENSION_BALL_JOINT', 'suspension-ball-joints', 100, 'HIGH', TRUE),
    ('SUSPENSION_BUSHING_MOUNT_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_BUSHING_MOUNT', 'suspension-bushings-mounts', 100, 'HIGH', TRUE),
    ('SUSPENSION_BUSHING_MOUNT_A_EPC33_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '33', 'TYPE_CODE', 'SUSPENSION_BUSHING_MOUNT', 'suspension-bushings-mounts', 100, 'HIGH', TRUE),
    ('SUSPENSION_BUSHING_MOUNT_A_EPC35_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '35', 'TYPE_CODE', 'SUSPENSION_BUSHING_MOUNT', 'suspension-bushings-mounts', 100, 'HIGH', TRUE),
    ('SUSPENSION_CONTROL_ARM_A_EPC33_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '33', 'TYPE_CODE', 'SUSPENSION_CONTROL_ARM', 'suspension-control-arms', 100, 'HIGH', TRUE),
    ('SUSPENSION_CONTROL_ARM_A_EPC35_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '35', 'TYPE_CODE', 'SUSPENSION_CONTROL_ARM', 'suspension-control-arms', 100, 'HIGH', TRUE),
    ('SUSPENSION_HYDRAULIC_COMPONENT_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_HYDRAULIC_COMPONENT', 'suspension-hydraulic-components', 100, 'HIGH', TRUE),
    ('SUSPENSION_KNUCKLE_CARRIER_A_EPC33_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '33', 'TYPE_CODE', 'SUSPENSION_KNUCKLE_CARRIER', 'suspension-knuckles-carriers', 100, 'HIGH', TRUE),
    ('SUSPENSION_LEVEL_CONTROL_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_LEVEL_CONTROL', 'suspension-level-control', 100, 'HIGH', TRUE),
    ('SUSPENSION_LINK_ROD_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_LINK_ROD', 'suspension-links-rods', 100, 'HIGH', TRUE),
    ('SUSPENSION_LINK_ROD_A_EPC33_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '33', 'TYPE_CODE', 'SUSPENSION_LINK_ROD', 'suspension-links-rods', 100, 'HIGH', TRUE),
    ('SUSPENSION_LINK_ROD_A_EPC35_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '35', 'TYPE_CODE', 'SUSPENSION_LINK_ROD', 'suspension-links-rods', 100, 'HIGH', TRUE),
    ('SUSPENSION_SHOCK_ABSORBER_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_SHOCK_ABSORBER', 'suspension-shock-absorbers', 100, 'HIGH', TRUE),
    ('SUSPENSION_SPRING_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_SPRING', 'suspension-springs', 100, 'HIGH', TRUE),
    ('SUSPENSION_STABILIZER_BUSHING_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_STABILIZER_BUSHING', 'suspension-stabilizer-bushings', 100, 'HIGH', TRUE),
    ('SUSPENSION_STABILIZER_LINK_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_STABILIZER_LINK', 'suspension-stabilizer-links', 100, 'HIGH', TRUE),
    ('SUSPENSION_STRUT_MOUNT_PROTECTION_A_EPC32_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '32', 'TYPE_CODE', 'SUSPENSION_STRUT_MOUNT_PROTECTION', 'suspension-strut-mounts-protection', 100, 'HIGH', TRUE),
    ('SUSPENSION_STRUT_MOUNT_PROTECTION_A_EPC33_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '33', 'TYPE_CODE', 'SUSPENSION_STRUT_MOUNT_PROTECTION', 'suspension-strut-mounts-protection', 100, 'HIGH', TRUE),
    ('SUSPENSION_STRUT_MOUNT_PROTECTION_A_EPC35_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '35', 'TYPE_CODE', 'SUSPENSION_STRUT_MOUNT_PROTECTION', 'suspension-strut-mounts-protection', 100, 'HIGH', TRUE),
    ('SUSPENSION_SUBFRAME_MOUNT_A_EPC33_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '33', 'TYPE_CODE', 'SUSPENSION_SUBFRAME_MOUNT', 'suspension-subframes', 100, 'HIGH', TRUE),
    ('SUSPENSION_SUBFRAME_MOUNT_A_EPC35_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '35', 'TYPE_CODE', 'SUSPENSION_SUBFRAME_MOUNT', 'suspension-subframes', 100, 'HIGH', TRUE),
    ('SUSPENSION_WHEEL_HUB_BEARING_A_EPC33_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '33', 'TYPE_CODE', 'SUSPENSION_WHEEL_HUB_BEARING', 'suspension-wheel-bearings-hubs', 100, 'HIGH', TRUE),
    ('SUSPENSION_WHEEL_HUB_BEARING_A_EPC35_PHASE2F_V1', 1, 6, 'RULE', 'PRIMARY', 'A', '35', 'TYPE_CODE', 'SUSPENSION_WHEEL_HUB_BEARING', 'suspension-wheel-bearings-hubs', 100, 'HIGH', TRUE)
), resolved AS (
  SELECT seed.*, category.id AS target_category_id
  FROM rule_seed seed
  JOIN customer_categories category
    ON category.slug = seed.target_category_slug
   AND category.status = 'ACTIVE'
   AND category.is_active = TRUE
)
INSERT INTO customer_classification_rules(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value,
  target_category_id, priority, confidence, auto_approval_allowed, is_active
)
SELECT
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value,
  target_category_id, priority, confidence, auto_approval_allowed, FALSE
FROM resolved
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
  updated_at = NOW();

-- Activate only the newest v6 row per code and never reactivate it after a
-- later detector generation has been deployed.
UPDATE customer_classification_rules current
SET is_active = TRUE,
    updated_at = NOW()
WHERE current.detector_version = 6
  AND current.version = (
    SELECT MAX(candidate.version)
    FROM customer_classification_rules candidate
    WHERE candidate.code = current.code
      AND candidate.detector_version = 6
  )
  AND NOT EXISTS (
    SELECT 1
    FROM customer_classification_rules newer
    WHERE newer.code = current.code
      AND newer.detector_version > 6
  );

DO $$
DECLARE
  expected_historical_v5 CONSTANT INTEGER := 192;
  expected_successors CONSTANT INTEGER := 192;
  expected_phase2f_rules CONSTANT INTEGER := 66;
  historical_v5 INTEGER;
  active_successors INTEGER;
  active_phase2f_rules INTEGER;
  duplicate_active_codes INTEGER;
  unsafe_split_epc_rules INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO historical_v5
  FROM customer_classification_rules
  WHERE detector_version = 5 AND is_active = FALSE;

  SELECT COUNT(*)::INTEGER INTO active_successors
  FROM customer_classification_rules successor
  WHERE successor.detector_version = 6
    AND successor.is_active = TRUE
    AND EXISTS (
      SELECT 1
      FROM customer_classification_rules historical
      WHERE historical.code = successor.code
        AND historical.detector_version = 5
        AND historical.version + 1 = successor.version
    );

  SELECT COUNT(*)::INTEGER INTO active_phase2f_rules
  FROM customer_classification_rules
  WHERE detector_version = 6
    AND is_active = TRUE
    AND code = ANY(ARRAY[
      'ENGINE_AIR_FILTER_HOUSING_A_EPC09_PHASE2F_V1',
      'ENGINE_BELT_ROLLER_IDLER_A_EPC20_PHASE2F_V1',
      'ENGINE_BELT_ROLLER_IDLER_A_EPC23_PHASE2F_V1',
      'ENGINE_BELT_TENSIONER_A_EPC20_PHASE2F_V1',
      'ENGINE_BLOCK_CRANKSHAFT_PISTON_A_EPC03_PHASE2F_V1',
      'ENGINE_COVER_CRANKCASE_A_EPC01_PHASE2F_V1',
      'ENGINE_COVER_CRANKCASE_A_EPC22_PHASE2F_V1',
      'ENGINE_CRANKCASE_VENTILATION_A_EPC01_PHASE2F_V1',
      'ENGINE_CYLINDER_HEAD_COMPONENT_A_EPC01_PHASE2F_V1',
      'ENGINE_DRIVE_PULLEY_A_EPC03_PHASE2F_V1',
      'ENGINE_DRIVE_PULLEY_A_EPC20_PHASE2F_V1',
      'ENGINE_GASKET_SEAL_A_EPC01_PHASE2F_V1',
      'ENGINE_GASKET_SEAL_A_EPC03_PHASE2F_V1',
      'ENGINE_GASKET_SEAL_A_EPC05_PHASE2F_V1',
      'ENGINE_GASKET_SEAL_A_EPC09_PHASE2F_V1',
      'ENGINE_GASKET_SEAL_A_EPC18_PHASE2F_V1',
      'ENGINE_INTAKE_AIR_DUCT_A_EPC09_PHASE2F_V1',
      'ENGINE_INTAKE_MANIFOLD_THROTTLE_A_EPC09_PHASE2F_V1',
      'ENGINE_INTAKE_MANIFOLD_THROTTLE_A_EPC14_PHASE2F_V1',
      'ENGINE_MOUNT_A_EPC22_PHASE2F_V1',
      'ENGINE_MOUNT_A_EPC24_PHASE2F_V1',
      'ENGINE_OIL_LINE_COOLER_A_EPC09_PHASE2F_V1',
      'ENGINE_OIL_LINE_COOLER_A_EPC18_PHASE2F_V1',
      'ENGINE_OIL_PUMP_A_EPC18_PHASE2F_V1',
      'ENGINE_OIL_SYSTEM_COMPONENT_A_EPC01_PHASE2F_V1',
      'ENGINE_OIL_SYSTEM_COMPONENT_A_EPC18_PHASE2F_V1',
      'ENGINE_SENSOR_A_EPC09_PHASE2F_V1',
      'ENGINE_TIMING_COMPONENT_A_EPC03_PHASE2F_V1',
      'ENGINE_TIMING_COMPONENT_A_EPC05_PHASE2F_V1',
      'ENGINE_TURBO_CHARGE_AIR_A_EPC09_PHASE2F_V1',
      'ENGINE_TURBO_CHARGE_AIR_A_EPC14_PHASE2F_V1',
      'ENGINE_VACUUM_COMPONENT_A_EPC09_PHASE2F_V1',
      'ENGINE_VACUUM_COMPONENT_A_EPC23_PHASE2F_V1',
      'ENGINE_VALVETRAIN_COMPONENT_A_EPC05_PHASE2F_V1',
      'FILTER_AIR_ENGINE_A_EPC18_PHASE2F_V1',
      'FILTER_AIR_ENGINE_A_EPC32_PHASE2F_V1',
      'FILTER_CABIN_A_EPC32_PHASE2F_V1',
      'FILTER_FUEL_A_EPC09_PHASE2F_V1',
      'FILTER_OIL_A_EPC01_PHASE2F_V1',
      'FILTER_OIL_A_EPC32_PHASE2F_V1',
      'SUSPENSION_AIR_COMPONENT_A_EPC32_PHASE2F_V1',
      'SUSPENSION_BALL_JOINT_A_EPC32_PHASE2F_V1',
      'SUSPENSION_BALL_JOINT_A_EPC33_PHASE2F_V1',
      'SUSPENSION_BALL_JOINT_A_EPC35_PHASE2F_V1',
      'SUSPENSION_BUSHING_MOUNT_A_EPC32_PHASE2F_V1',
      'SUSPENSION_BUSHING_MOUNT_A_EPC33_PHASE2F_V1',
      'SUSPENSION_BUSHING_MOUNT_A_EPC35_PHASE2F_V1',
      'SUSPENSION_CONTROL_ARM_A_EPC33_PHASE2F_V1',
      'SUSPENSION_CONTROL_ARM_A_EPC35_PHASE2F_V1',
      'SUSPENSION_HYDRAULIC_COMPONENT_A_EPC32_PHASE2F_V1',
      'SUSPENSION_KNUCKLE_CARRIER_A_EPC33_PHASE2F_V1',
      'SUSPENSION_LEVEL_CONTROL_A_EPC32_PHASE2F_V1',
      'SUSPENSION_LINK_ROD_A_EPC32_PHASE2F_V1',
      'SUSPENSION_LINK_ROD_A_EPC33_PHASE2F_V1',
      'SUSPENSION_LINK_ROD_A_EPC35_PHASE2F_V1',
      'SUSPENSION_SHOCK_ABSORBER_A_EPC32_PHASE2F_V1',
      'SUSPENSION_SPRING_A_EPC32_PHASE2F_V1',
      'SUSPENSION_STABILIZER_BUSHING_A_EPC32_PHASE2F_V1',
      'SUSPENSION_STABILIZER_LINK_A_EPC32_PHASE2F_V1',
      'SUSPENSION_STRUT_MOUNT_PROTECTION_A_EPC32_PHASE2F_V1',
      'SUSPENSION_STRUT_MOUNT_PROTECTION_A_EPC33_PHASE2F_V1',
      'SUSPENSION_STRUT_MOUNT_PROTECTION_A_EPC35_PHASE2F_V1',
      'SUSPENSION_SUBFRAME_MOUNT_A_EPC33_PHASE2F_V1',
      'SUSPENSION_SUBFRAME_MOUNT_A_EPC35_PHASE2F_V1',
      'SUSPENSION_WHEEL_HUB_BEARING_A_EPC33_PHASE2F_V1',
      'SUSPENSION_WHEEL_HUB_BEARING_A_EPC35_PHASE2F_V1'
    ]::TEXT[]);

  SELECT COUNT(*)::INTEGER INTO duplicate_active_codes
  FROM (
    SELECT code
    FROM customer_classification_rules
    WHERE is_active = TRUE
    GROUP BY code
    HAVING COUNT(*) > 1
  ) duplicate;

  SELECT COUNT(*)::INTEGER INTO unsafe_split_epc_rules
  FROM customer_classification_rules
  WHERE detector_version = 6
    AND is_active = TRUE
    AND epc_group = ANY(ARRAY['01','09','14','18','20','22','23','24','32','33','35']::TEXT[])
    AND match_type = 'EPC_ONLY';

  IF historical_v5 <> expected_historical_v5 THEN
    RAISE EXCEPTION 'Expected % historical detector-v5 rules, found %',
      expected_historical_v5, historical_v5;
  END IF;
  IF active_successors <> expected_successors THEN
    RAISE EXCEPTION 'Expected % active detector-v6 successors, found %',
      expected_successors, active_successors;
  END IF;
  IF active_phase2f_rules <> expected_phase2f_rules THEN
    RAISE EXCEPTION 'Expected % active PHASE 2F rules, found %',
      expected_phase2f_rules, active_phase2f_rules;
  END IF;
  IF duplicate_active_codes <> 0 THEN
    RAISE EXCEPTION 'Found % codes with multiple active versions',
      duplicate_active_codes;
  END IF;
  IF unsafe_split_epc_rules <> 0 THEN
    RAISE EXCEPTION 'Found % unsafe whole-group rules for split PHASE 2F EPC groups',
      unsafe_split_epc_rules;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('096_seed_customer_taxonomy_phase2f_rules')
ON CONFLICT(version) DO NOTHING;

COMMIT;
