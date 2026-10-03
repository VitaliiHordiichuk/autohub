BEGIN;

-- PHASE 2 seeds only reviewed HIGH-confidence rules. It deliberately creates
-- no product_customer_categories rows and leaves the technical EPC taxonomy
-- (categories/product_categories and their classifiers) untouched.
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
    ('FILTER_OIL_A_EPC18_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '18', 'TYPE_CODE', 'FILTER_OIL', 'filters-oil', 100, 'HIGH', TRUE, TRUE),
    ('FILTER_AIR_ENGINE_A_EPC09_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '09', 'TYPE_CODE', 'FILTER_AIR_ENGINE', 'filters-engine-air', 100, 'HIGH', TRUE, TRUE),
    ('FILTER_CABIN_A_EPC83_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '83', 'TYPE_CODE', 'FILTER_CABIN', 'filters-cabin', 100, 'HIGH', TRUE, TRUE),
    ('FILTER_FUEL_A_EPC47_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '47', 'TYPE_CODE', 'FILTER_FUEL', 'filters-fuel', 100, 'HIGH', TRUE, TRUE),
    ('FILTER_IGNITION_A_EPC15_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '15', 'TYPE_CODE', 'IGNITION_SPARK_PLUG', 'filters-spark-ignition', 100, 'HIGH', TRUE, TRUE),
    ('FILTER_IGNITION_A_EPC90_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'IGNITION_SPARK_PLUG', 'filters-spark-ignition', 100, 'HIGH', TRUE, TRUE),
    ('FILTER_WIPER_A_EPC82_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '82', 'TYPE_CODE', 'WIPER_BLADE', 'filters-wipers', 100, 'HIGH', TRUE, TRUE),
    ('BRAKE_PAD_A_EPC42_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '42', 'TYPE_CODE', 'BRAKE_PAD', 'brakes-pads', 100, 'HIGH', TRUE, TRUE),
    ('BRAKE_DISC_A_EPC42_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '42', 'TYPE_CODE', 'BRAKE_DISC', 'brakes-discs', 100, 'HIGH', TRUE, TRUE),
    ('BRAKE_CALIPER_A_EPC42_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '42', 'TYPE_CODE', 'BRAKE_CALIPER', 'brakes-calipers', 100, 'HIGH', TRUE, TRUE),
    ('BRAKE_SENSOR_A_EPC44_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '44', 'TYPE_CODE', 'BRAKE_SENSOR', 'brakes-sensors', 100, 'HIGH', TRUE, TRUE),
    ('BRAKE_SENSOR_A_EPC54_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '54', 'TYPE_CODE', 'BRAKE_SENSOR', 'brakes-sensors', 100, 'HIGH', TRUE, TRUE),
    ('BRAKE_SENSOR_A_EPC90_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '90', 'TYPE_CODE', 'BRAKE_SENSOR', 'brakes-sensors', 100, 'HIGH', TRUE, TRUE),
    ('BRAKE_HOSE_PIPE_A_EPC42_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '42', 'TYPE_CODE', 'BRAKE_HOSE_PIPE', 'brakes-hoses-pipes', 100, 'HIGH', TRUE, TRUE),
    ('BRAKE_HOSE_PIPE_A_EPC43_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '43', 'TYPE_CODE', 'BRAKE_HOSE_PIPE', 'brakes-hoses-pipes', 100, 'HIGH', TRUE, TRUE),
    ('BRAKE_MASTER_CYLINDER_A_EPC43_V1', 1, 2, 'RULE', 'PRIMARY', 'A', '43', 'TYPE_CODE', 'BRAKE_MASTER_CYLINDER', 'brakes-master-cylinders', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_PREFIX_B6604_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6604', 'accessories-collection', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_PREFIX_B6645_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6645', 'accessories-collection', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_PREFIX_B6695_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6695', 'accessories-collection', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_PREFIX_B6696_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6696', 'accessories-collection', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_PREFIX_B6796_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6796', 'accessories-collection', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_PREFIX_B6799_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6799', 'accessories-collection', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_B_PREFIX_B6603_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6603', 'accessories-floor-mats', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_B_PREFIX_B6629_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6629', 'accessories-floor-mats', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_B_PREFIX_B6635_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6635', 'accessories-floor-mats', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_B_PREFIX_B6636_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6636', 'accessories-floor-mats', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_B_PREFIX_B6656_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6656', 'accessories-floor-mats', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_B_PREFIX_B6668_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6668', 'accessories-floor-mats', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_B_PREFIX_B6768_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6768', 'accessories-floor-mats', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_WHEELS_B_PREFIX_B6647_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6647', 'accessories-wheels', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_WHEELS_B_PREFIX_B6781_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6781', 'accessories-wheels', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_EXTERIOR_B_PREFIX_B6652_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6652', 'accessories-exterior', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_EXTERIOR_B_PREFIX_B6664_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6664', 'accessories-exterior', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_EXTERIOR_B_PREFIX_B6688_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6688', 'accessories-exterior', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_EXTERIOR_B_PREFIX_B6689_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_PREFIX', 'B6689', 'accessories-exterior', 100, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_WHEELS_A_A0005851795_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A0005851795', 'accessories-wheels', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A0008401200_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A0008401200', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A1176800046_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1176800046', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_EXTERIOR_A_A1648990640_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1648990640', 'accessories-exterior', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A1666800246_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1666800246', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A1666804102687M31_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1666804102687M31', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A1668140241_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1668140241', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A16768063069G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A16768063069G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A16768069069G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A16768069069G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A16768072069G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A16768072069G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A1676807510649J74_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1676807510649J74', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A16768076069G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A16768076069G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A16768079069G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A16768079069G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A16768095049G32_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A16768095049G32', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A16768097049G32_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A16768097049G32', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A1676846500_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1676846500', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A1676846600_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1676846600', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A1678140000_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1678140000', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A1678140100_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1678140100', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A167814030028_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A167814030028', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A17668050019G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A17668050019G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A17668051019G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A17668051019G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_EXTERIOR_A_A1768900178_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A1768900178', 'accessories-exterior', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A20468045489G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A20468045489G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A20468413039F95_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A20468413039F95', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2048140041_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2048140041', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A20568022489G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A20568022489G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A20568075089G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A20568075089G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A20568076089G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A20568076089G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A20568095019G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A20568095019G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2058140500_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2058140500', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2058140600_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2058140600', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2128140041_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2128140041', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A213860290164_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A213860290164', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A22268045489G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A22268045489G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A22268050488U51_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A22268050488U51', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A22268052489G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A22268052489G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A22268076059G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A22268076059G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A22268077059G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A22268077059G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A22368008059051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A22368008059051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A22368015059051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A22368015059051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A22368017059051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A22368017059051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2236807604_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2236807604', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A24268010489G32_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A24268010489G32', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2468140000_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2468140000', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A24768073029G32_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A24768073029G32', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2536806601_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2536806601', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2538140300_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2538140300', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2538600900_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2538600900', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A25468004049051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A25468004049051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A25468014049051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A25468014049051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2966805405_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2966805405', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A29668082069051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A29668082069051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A2968140700_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A2968140700', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A29768048069051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A29768048069051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A29768055069051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A29768055069051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A44768051059G33_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A44768051059G33', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A4476805302_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A4476805302', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A44768075069G32_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A44768075069G32', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A4476809000_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A4476809000', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A4476809801_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A4476809801', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_EXTERIOR_A_A4478900000_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A4478900000', 'accessories-exterior', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_EXTERIOR_A_A4478900100_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A4478900100', 'accessories-exterior', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A4518140007_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A4518140007', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A46368047069051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A46368047069051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_A_A463814000028_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A463814000028', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A46568091019051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A46568091019051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A46568092019051_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A46568092019051', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_FLOOR_MATS_A_A6396802048_V1', 1, 2, 'RULE', 'PRIMARY', 'A', NULL, 'ARTICLE_EXACT', 'A6396802048', 'accessories-floor-mats', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_INTERIOR_B_B67660042_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67660042', 'accessories-interior', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_LUGGAGE_B_B67660114_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67660114', 'accessories-luggage', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_B67870266_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67870266', 'accessories-collection', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_B67870429_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67870429', 'accessories-collection', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_B67870476_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67870476', 'accessories-collection', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_B67871178_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67871178', 'accessories-collection', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_B67871182_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67871182', 'accessories-collection', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_B67871265_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67871265', 'accessories-collection', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_COLLECTION_B_B67872159_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67872159', 'accessories-collection', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_MULTIMEDIA_B_B67875707_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67875707', 'accessories-multimedia', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_MULTIMEDIA_B_B67875709_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67875709', 'accessories-multimedia', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_MULTIMEDIA_B_B67875718_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67875718', 'accessories-multimedia', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_MULTIMEDIA_B_B67875855_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67875855', 'accessories-multimedia', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_MULTIMEDIA_B_B67881115_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67881115', 'accessories-multimedia', 10, 'HIGH', TRUE, TRUE),
    ('ACCESSORY_WHEELS_B_B67885111_V1', 1, 2, 'RULE', 'PRIMARY', 'B', NULL, 'ARTICLE_EXACT', 'B67885111', 'accessories-wheels', 10, 'HIGH', TRUE, TRUE)
), resolved_rules AS (
  SELECT
    rule_seed.*,
    category.id AS target_category_id
  FROM rule_seed
  JOIN customer_categories category
    ON category.slug = rule_seed.target_category_slug
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
ON CONFLICT(code, version)
DO UPDATE SET
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
  expected_target_count CONSTANT INTEGER := 19;
  actual_target_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO actual_target_count
  FROM customer_categories
  WHERE slug = ANY(ARRAY['accessories-collection', 'accessories-exterior', 'accessories-floor-mats', 'accessories-interior', 'accessories-luggage', 'accessories-multimedia', 'accessories-wheels', 'brakes-calipers', 'brakes-discs', 'brakes-hoses-pipes', 'brakes-master-cylinders', 'brakes-pads', 'brakes-sensors', 'filters-cabin', 'filters-engine-air', 'filters-fuel', 'filters-oil', 'filters-spark-ignition', 'filters-wipers']::TEXT[])
    AND status = 'ACTIVE'
    AND is_active = TRUE;

  IF actual_target_count <> expected_target_count THEN
    RAISE EXCEPTION
      'Customer taxonomy rule seed expected % active targets but found %',
      expected_target_count,
      actual_target_count;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('088_seed_customer_taxonomy_rules')
ON CONFLICT(version) DO NOTHING;

COMMIT;
