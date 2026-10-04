BEGIN;

-- Detector v5 extends the closed semantic contract. Keep all detector-v4
-- rows immutable for historical memberships and publish one v5 successor per
-- active logical rule. No membership table is touched by this migration.
UPDATE customer_classification_rules
SET is_active = FALSE,
    updated_at = NOW()
WHERE detector_version = 4
  AND is_active = TRUE;

INSERT INTO customer_classification_rules(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value, exclude_values,
  target_category_id, priority, confidence, auto_approval_allowed, is_active
)
SELECT
  previous.code,
  previous.version + 1,
  5,
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
WHERE previous.detector_version = 4
  AND previous.version = (
    SELECT MAX(candidate.version)
    FROM customer_classification_rules candidate
    WHERE candidate.code = previous.code
      AND candidate.detector_version = 4
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

WITH rule_seed(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value,
  target_category_slug, priority, confidence, auto_approval_allowed
) AS (
  VALUES
    ('AC_CONDENSER_A_EPC50_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '50', 'TYPE_CODE', 'AC_CONDENSER', 'climate-condensers', 100, 'HIGH', TRUE),
    ('AC_RECEIVER_DRIER_A_EPC83_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '83', 'TYPE_CODE', 'AC_RECEIVER_DRIER', 'climate-receiver-driers', 100, 'HIGH', TRUE),
    ('AC_REFRIGERANT_LINE_A_EPC50_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '50', 'TYPE_CODE', 'AC_REFRIGERANT_LINE', 'climate-hoses-pipes', 100, 'HIGH', TRUE),
    ('ADBLUE_SCR_COMPONENT_A_EPC47_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '47', 'TYPE_CODE', 'ADBLUE_SCR_COMPONENT', 'exhaust-adblue-scr', 100, 'HIGH', TRUE),
    ('CLUTCH_ASSEMBLY_A_EPC25_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '25', 'TYPE_CODE', 'CLUTCH_ASSEMBLY', 'transmission-clutch-components', 100, 'HIGH', TRUE),
    ('CLUTCH_RELEASE_BEARING_A_EPC25_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '25', 'TYPE_CODE', 'CLUTCH_RELEASE_BEARING', 'transmission-clutch-components', 100, 'HIGH', TRUE),
    ('COOLING_CONTROL_VALVE_A_EPC50_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '50', 'TYPE_CODE', 'COOLING_CONTROL_VALVE', 'cooling-control-valves', 100, 'HIGH', TRUE),
    ('COOLING_EXPANSION_TANK_A_EPC50_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '50', 'TYPE_CODE', 'COOLING_EXPANSION_TANK', 'cooling-expansion-tanks', 100, 'HIGH', TRUE),
    ('COOLING_HOSE_PIPE_A_EPC20_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '20', 'TYPE_CODE', 'COOLING_HOSE_PIPE', 'cooling-hoses-pipes', 100, 'HIGH', TRUE),
    ('COOLING_HOSE_PIPE_A_EPC50_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '50', 'TYPE_CODE', 'COOLING_HOSE_PIPE', 'cooling-hoses-pipes', 100, 'HIGH', TRUE),
    ('COOLING_RADIATOR_A_EPC50_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '50', 'TYPE_CODE', 'COOLING_RADIATOR', 'cooling-radiators', 100, 'HIGH', TRUE),
    ('COOLING_RADIATOR_AIR_GUIDE_A_EPC50_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '50', 'TYPE_CODE', 'COOLING_RADIATOR_AIR_GUIDE', 'cooling-radiator-air-guides-mounts', 100, 'HIGH', TRUE),
    ('COOLING_THERMOSTAT_A_EPC20_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '20', 'TYPE_CODE', 'COOLING_THERMOSTAT', 'cooling-thermostats', 100, 'HIGH', TRUE),
    ('COOLING_THERMOSTAT_A_EPC50_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '50', 'TYPE_CODE', 'COOLING_THERMOSTAT', 'cooling-thermostats', 100, 'HIGH', TRUE),
    ('COOLING_WATER_PUMP_A_EPC20_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '20', 'TYPE_CODE', 'COOLING_WATER_PUMP', 'cooling-water-pumps', 100, 'HIGH', TRUE),
    ('COOLING_WATER_PUMP_A_EPC50_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '50', 'TYPE_CODE', 'COOLING_WATER_PUMP', 'cooling-water-pumps', 100, 'HIGH', TRUE),
    ('DRIVETRAIN_COUPLING_DAMPER_A_EPC41_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '41', 'TYPE_CODE', 'DRIVETRAIN_COUPLING_DAMPER', 'drivetrain-couplings-dampers', 100, 'HIGH', TRUE),
    ('DRIVETRAIN_CV_BOOT_A_EPC36_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '36', 'TYPE_CODE', 'DRIVETRAIN_CV_BOOT', 'drivetrain-cv-boots', 100, 'HIGH', TRUE),
    ('DRIVETRAIN_PROPELLER_SHAFT_A_EPC41_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '41', 'TYPE_CODE', 'DRIVETRAIN_PROPELLER_SHAFT', 'drivetrain-propeller-shafts', 100, 'HIGH', TRUE),
    ('FILTER_CABIN_KIT_A_EPC83_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '83', 'TYPE_CODE', 'FILTER_CABIN_KIT', 'filters-cabin', 100, 'HIGH', TRUE),
    ('FUEL_INJECTOR_A_EPC07_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '07', 'TYPE_CODE', 'FUEL_INJECTOR', 'fuel-injectors', 100, 'HIGH', TRUE),
    ('FUEL_LINE_HOSE_A_EPC07_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '07', 'TYPE_CODE', 'FUEL_LINE_HOSE', 'fuel-lines-hoses', 100, 'HIGH', TRUE),
    ('FUEL_LINE_HOSE_A_EPC47_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '47', 'TYPE_CODE', 'FUEL_LINE_HOSE', 'fuel-lines-hoses', 100, 'HIGH', TRUE),
    ('FUEL_PRESSURE_VALVE_A_EPC07_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '07', 'TYPE_CODE', 'FUEL_PRESSURE_VALVE', 'fuel-pressure-valves', 100, 'HIGH', TRUE),
    ('FUEL_PUMP_A_EPC07_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '07', 'TYPE_CODE', 'FUEL_PUMP', 'fuel-pumps', 100, 'HIGH', TRUE),
    ('FUEL_PUMP_A_EPC47_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '47', 'TYPE_CODE', 'FUEL_PUMP', 'fuel-pumps', 100, 'HIGH', TRUE),
    ('FUEL_RAIL_A_EPC07_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '07', 'TYPE_CODE', 'FUEL_RAIL', 'fuel-rails', 100, 'HIGH', TRUE),
    ('FUEL_TANK_MODULE_A_EPC47_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '47', 'TYPE_CODE', 'FUEL_TANK_MODULE', 'fuel-tanks-modules', 100, 'HIGH', TRUE),
    ('FUEL_VAPOR_CANISTER_A_EPC47_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '47', 'TYPE_CODE', 'FUEL_VAPOR_CANISTER', 'fuel-vapor-canisters', 100, 'HIGH', TRUE),
    ('HVAC_AIR_DUCT_VENT_A_EPC83_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '83', 'TYPE_CODE', 'HVAC_AIR_DUCT_VENT', 'climate-air-ducts-vents', 100, 'HIGH', TRUE),
    ('HVAC_BLOWER_MOTOR_A_EPC83_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '83', 'TYPE_CODE', 'HVAC_BLOWER_MOTOR', 'climate-blower-motors', 100, 'HIGH', TRUE),
    ('HVAC_CONTROL_VALVE_A_EPC83_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '83', 'TYPE_CODE', 'HVAC_CONTROL_VALVE', 'climate-control-valves', 100, 'HIGH', TRUE),
    ('HVAC_DRAIN_LINE_A_EPC83_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '83', 'TYPE_CODE', 'HVAC_DRAIN_LINE', 'climate-hoses-pipes', 100, 'HIGH', TRUE),
    ('HVAC_HOSE_PIPE_A_EPC83_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '83', 'TYPE_CODE', 'HVAC_HOSE_PIPE', 'climate-hoses-pipes', 100, 'HIGH', TRUE),
    ('HVAC_TEMPERATURE_SENSOR_A_EPC83_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '83', 'TYPE_CODE', 'HVAC_TEMPERATURE_SENSOR', 'climate-sensors', 100, 'HIGH', TRUE),
    ('TRANSFER_CASE_COMPONENT_A_EPC28_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '28', 'TYPE_CODE', 'TRANSFER_CASE_COMPONENT', 'transfer-case-parts', 100, 'HIGH', TRUE),
    ('TRANSMISSION_COOLER_LINE_A_EPC50_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '50', 'TYPE_CODE', 'TRANSMISSION_COOLER_LINE', 'transmission-fluid-lines', 100, 'HIGH', TRUE),
    ('TRANSMISSION_FLUID_LINE_A_EPC27_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '27', 'TYPE_CODE', 'TRANSMISSION_FLUID_LINE', 'transmission-fluid-lines', 100, 'HIGH', TRUE),
    ('TRANSMISSION_FLUID_LINE_A_EPC37_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '37', 'TYPE_CODE', 'TRANSMISSION_FLUID_LINE', 'transmission-fluid-lines', 100, 'HIGH', TRUE),
    ('TRANSMISSION_OIL_FILTER_A_EPC27_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '27', 'TYPE_CODE', 'TRANSMISSION_OIL_FILTER', 'transmission-oil-filters', 100, 'HIGH', TRUE),
    ('TRANSMISSION_OIL_FILTER_A_EPC37_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '37', 'TYPE_CODE', 'TRANSMISSION_OIL_FILTER', 'transmission-oil-filters', 100, 'HIGH', TRUE),
    ('TRANSMISSION_OIL_PAN_A_EPC27_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '27', 'TYPE_CODE', 'TRANSMISSION_OIL_PAN', 'transmission-oil-pans', 100, 'HIGH', TRUE),
    ('TRANSMISSION_SEAL_GASKET_A_EPC27_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '27', 'TYPE_CODE', 'TRANSMISSION_SEAL_GASKET', 'transmission-seals-gaskets', 100, 'HIGH', TRUE),
    ('TRANSMISSION_SEAL_GASKET_A_EPC37_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '37', 'TYPE_CODE', 'TRANSMISSION_SEAL_GASKET', 'transmission-seals-gaskets', 100, 'HIGH', TRUE),
    ('TRANSMISSION_SELECTOR_LINKAGE_A_EPC26_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '26', 'TYPE_CODE', 'TRANSMISSION_SELECTOR_LINKAGE', 'transmission-selector-linkage', 100, 'HIGH', TRUE),
    ('TRANSMISSION_VALVE_BODY_A_EPC27_PHASE2E_V1', 1, 5, 'RULE', 'PRIMARY', 'A', '27', 'TYPE_CODE', 'TRANSMISSION_VALVE_BODY', 'transmission-valve-bodies', 100, 'HIGH', TRUE)
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

-- Activate only the newest v5 row for each code, and never reactivate it when
-- a later detector generation already exists.
UPDATE customer_classification_rules current
SET is_active = TRUE,
    updated_at = NOW()
WHERE current.detector_version = 5
  AND current.version = (
    SELECT MAX(candidate.version)
    FROM customer_classification_rules candidate
    WHERE candidate.code = current.code
      AND candidate.detector_version = 5
  )
  AND NOT EXISTS (
    SELECT 1
    FROM customer_classification_rules newer
    WHERE newer.code = current.code
      AND newer.detector_version > 5
  );

DO $$
DECLARE
  expected_historical_v4 CONSTANT INTEGER := 146;
  expected_successors CONSTANT INTEGER := 146;
  expected_phase2e_rules CONSTANT INTEGER := 46;
  historical_v4 INTEGER;
  active_successors INTEGER;
  active_phase2e_rules INTEGER;
  duplicate_active_codes INTEGER;
  unsafe_split_epc_rules INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO historical_v4
  FROM customer_classification_rules
  WHERE detector_version = 4 AND is_active = FALSE;

  SELECT COUNT(*)::INTEGER INTO active_successors
  FROM customer_classification_rules successor
  WHERE successor.detector_version = 5
    AND successor.is_active = TRUE
    AND EXISTS (
      SELECT 1
      FROM customer_classification_rules historical
      WHERE historical.code = successor.code
        AND historical.detector_version = 4
        AND historical.version + 1 = successor.version
    );

  SELECT COUNT(*)::INTEGER INTO active_phase2e_rules
  FROM customer_classification_rules
  WHERE detector_version = 5
    AND is_active = TRUE
    AND code = ANY(ARRAY[
      'AC_CONDENSER_A_EPC50_PHASE2E_V1',
      'AC_RECEIVER_DRIER_A_EPC83_PHASE2E_V1',
      'AC_REFRIGERANT_LINE_A_EPC50_PHASE2E_V1',
      'ADBLUE_SCR_COMPONENT_A_EPC47_PHASE2E_V1',
      'CLUTCH_ASSEMBLY_A_EPC25_PHASE2E_V1',
      'CLUTCH_RELEASE_BEARING_A_EPC25_PHASE2E_V1',
      'COOLING_CONTROL_VALVE_A_EPC50_PHASE2E_V1',
      'COOLING_EXPANSION_TANK_A_EPC50_PHASE2E_V1',
      'COOLING_HOSE_PIPE_A_EPC20_PHASE2E_V1',
      'COOLING_HOSE_PIPE_A_EPC50_PHASE2E_V1',
      'COOLING_RADIATOR_A_EPC50_PHASE2E_V1',
      'COOLING_RADIATOR_AIR_GUIDE_A_EPC50_PHASE2E_V1',
      'COOLING_THERMOSTAT_A_EPC20_PHASE2E_V1',
      'COOLING_THERMOSTAT_A_EPC50_PHASE2E_V1',
      'COOLING_WATER_PUMP_A_EPC20_PHASE2E_V1',
      'COOLING_WATER_PUMP_A_EPC50_PHASE2E_V1',
      'DRIVETRAIN_COUPLING_DAMPER_A_EPC41_PHASE2E_V1',
      'DRIVETRAIN_CV_BOOT_A_EPC36_PHASE2E_V1',
      'DRIVETRAIN_PROPELLER_SHAFT_A_EPC41_PHASE2E_V1',
      'FILTER_CABIN_KIT_A_EPC83_PHASE2E_V1',
      'FUEL_INJECTOR_A_EPC07_PHASE2E_V1',
      'FUEL_LINE_HOSE_A_EPC07_PHASE2E_V1',
      'FUEL_LINE_HOSE_A_EPC47_PHASE2E_V1',
      'FUEL_PRESSURE_VALVE_A_EPC07_PHASE2E_V1',
      'FUEL_PUMP_A_EPC07_PHASE2E_V1',
      'FUEL_PUMP_A_EPC47_PHASE2E_V1',
      'FUEL_RAIL_A_EPC07_PHASE2E_V1',
      'FUEL_TANK_MODULE_A_EPC47_PHASE2E_V1',
      'FUEL_VAPOR_CANISTER_A_EPC47_PHASE2E_V1',
      'HVAC_AIR_DUCT_VENT_A_EPC83_PHASE2E_V1',
      'HVAC_BLOWER_MOTOR_A_EPC83_PHASE2E_V1',
      'HVAC_CONTROL_VALVE_A_EPC83_PHASE2E_V1',
      'HVAC_DRAIN_LINE_A_EPC83_PHASE2E_V1',
      'HVAC_HOSE_PIPE_A_EPC83_PHASE2E_V1',
      'HVAC_TEMPERATURE_SENSOR_A_EPC83_PHASE2E_V1',
      'TRANSFER_CASE_COMPONENT_A_EPC28_PHASE2E_V1',
      'TRANSMISSION_COOLER_LINE_A_EPC50_PHASE2E_V1',
      'TRANSMISSION_FLUID_LINE_A_EPC27_PHASE2E_V1',
      'TRANSMISSION_FLUID_LINE_A_EPC37_PHASE2E_V1',
      'TRANSMISSION_OIL_FILTER_A_EPC27_PHASE2E_V1',
      'TRANSMISSION_OIL_FILTER_A_EPC37_PHASE2E_V1',
      'TRANSMISSION_OIL_PAN_A_EPC27_PHASE2E_V1',
      'TRANSMISSION_SEAL_GASKET_A_EPC27_PHASE2E_V1',
      'TRANSMISSION_SEAL_GASKET_A_EPC37_PHASE2E_V1',
      'TRANSMISSION_SELECTOR_LINKAGE_A_EPC26_PHASE2E_V1',
      'TRANSMISSION_VALVE_BODY_A_EPC27_PHASE2E_V1'
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
  WHERE detector_version = 5
    AND is_active = TRUE
    AND epc_group = ANY(ARRAY['07', '20', '47', '50', '83']::TEXT[])
    AND match_type = 'EPC_ONLY';

  IF historical_v4 <> expected_historical_v4 THEN
    RAISE EXCEPTION 'Expected % historical detector-v4 rules, found %',
      expected_historical_v4, historical_v4;
  END IF;
  IF active_successors <> expected_successors THEN
    RAISE EXCEPTION 'Expected % active detector-v5 successors, found %',
      expected_successors, active_successors;
  END IF;
  IF active_phase2e_rules <> expected_phase2e_rules THEN
    RAISE EXCEPTION 'Expected % active PHASE 2E rules, found %',
      expected_phase2e_rules, active_phase2e_rules;
  END IF;
  IF duplicate_active_codes <> 0 THEN
    RAISE EXCEPTION 'Found % codes with multiple active versions', duplicate_active_codes;
  END IF;
  IF unsafe_split_epc_rules <> 0 THEN
    RAISE EXCEPTION 'Found % unsafe whole-group rules for split EPC groups',
      unsafe_split_epc_rules;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('094_seed_customer_taxonomy_phase2e_rules')
ON CONFLICT(version) DO NOTHING;

COMMIT;
