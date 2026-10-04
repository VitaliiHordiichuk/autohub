BEGIN;

-- Detector v4 splits semantically different wheel covers and distinguishes
-- EGR/AdBlue parts. Existing detector-v3 rules remain immutable history.
WITH new_leaf(
  parent_slug,
  slug,
  sort_order,
  name_uk,
  name_ru,
  name_en
) AS (
  VALUES
    ('exhaust', 'exhaust-egr', 35,
      'Система рециркуляції EGR', 'Система рециркуляции EGR', 'EGR system'),
    ('exhaust', 'exhaust-adblue-scr', 45,
      'Система AdBlue та SCR', 'Система AdBlue и SCR', 'AdBlue and SCR system'),
    ('wheels', 'wheels-valve-caps', 25,
      'Ковпачки вентилів коліс', 'Колпачки вентилей колёс', 'Wheel valve caps')
), upserted AS (
  INSERT INTO customer_categories(
    slug,
    parent_id,
    status,
    is_active,
    is_navigation_visible,
    sort_order
  )
  SELECT
    leaf.slug,
    parent.id,
    'ACTIVE',
    TRUE,
    FALSE,
    leaf.sort_order
  FROM new_leaf leaf
  JOIN customer_categories parent ON parent.slug = leaf.parent_slug
  ON CONFLICT (slug) DO UPDATE SET
    parent_id = EXCLUDED.parent_id,
    status = 'ACTIVE',
    is_active = TRUE,
    is_navigation_visible = FALSE,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW()
  RETURNING id, slug
)
INSERT INTO customer_category_translations(category_id, language_code, name)
SELECT category.id, translation.language_code, translation.name
FROM new_leaf source
JOIN upserted category ON category.slug = source.slug
CROSS JOIN LATERAL (
  VALUES
    ('uk', source.name_uk),
    ('ru', source.name_ru),
    ('en', source.name_en)
) translation(language_code, name)
ON CONFLICT (category_id, language_code) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();

-- The existing wheels-caps leaf now has a deliberately narrow meaning.
WITH renamed(language_code, name) AS (
  VALUES
    ('uk', 'Центральні ковпаки та заглушки дисків'),
    ('ru', 'Центральные колпаки и заглушки дисков'),
    ('en', 'Wheel centre and hub caps')
)
UPDATE customer_category_translations translation
SET name = renamed.name,
    updated_at = NOW()
FROM customer_categories category, renamed
WHERE category.slug = 'wheels-caps'
  AND translation.category_id = category.id
  AND translation.language_code = renamed.language_code;

-- Retire detector-v3 rules without changing their code, version or target.
UPDATE customer_classification_rules
SET is_active = FALSE,
    updated_at = NOW()
WHERE detector_version = 3
  AND is_active = TRUE;

-- Every detector-v3 logical rule except the superseded broad WHEEL_CAP rule
-- gets a new detector-v4 successor. AdBlue keeps its logical rule code but
-- moves to the precise leaf. Historical memberships stay on old versions.
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
  previous.code,
  previous.version + 1,
  4,
  previous.source_kind,
  previous.assignment_role,
  previous.number_family,
  previous.epc_group,
  previous.match_type,
  previous.match_value,
  previous.exclude_values,
  CASE
    WHEN previous.code = 'EXHAUST_ADBLUE_INJECTOR_A_EPC49_V1'
    THEN adblue.id
    ELSE previous.target_category_id
  END,
  previous.priority,
  previous.confidence,
  previous.auto_approval_allowed,
  FALSE
FROM customer_classification_rules previous
LEFT JOIN customer_categories adblue
  ON adblue.slug = 'exhaust-adblue-scr'
WHERE previous.detector_version = 3
  AND previous.code <> 'WHEEL_CAP_A_EPC40_V1'
  AND previous.version = (
    SELECT MAX(candidate.version)
    FROM customer_classification_rules candidate
    WHERE candidate.code = previous.code
      AND candidate.detector_version = 3
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
  auto_approval_allowed
) AS (
  VALUES
    ('EXHAUST_EGR_PIPE_A_EPC14_V1', 1, 4, 'RULE', 'PRIMARY', 'A', '14',
      'TYPE_CODE', 'EXHAUST_EGR_PIPE', 'exhaust-egr', 100, 'HIGH', TRUE),
    ('WHEEL_CENTER_CAP_A_EPC40_V1', 1, 4, 'RULE', 'PRIMARY', 'A', '40',
      'TYPE_CODE', 'WHEEL_CENTER_CAP', 'wheels-caps', 100, 'HIGH', TRUE),
    ('WHEEL_VALVE_CAP_A_EPC40_V1', 1, 4, 'RULE', 'PRIMARY', 'A', '40',
      'TYPE_CODE', 'WHEEL_VALVE_CAP', 'wheels-valve-caps', 100, 'HIGH', TRUE)
), resolved AS (
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
  FALSE
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

-- Activate only the newest v4 row for each logical code and never reactivate
-- it if a later detector generation already exists.
UPDATE customer_classification_rules current
SET is_active = TRUE,
    updated_at = NOW()
WHERE current.detector_version = 4
  AND current.version = (
    SELECT MAX(candidate.version)
    FROM customer_classification_rules candidate
    WHERE candidate.code = current.code
      AND candidate.detector_version = 4
  )
  AND NOT EXISTS (
    SELECT 1
    FROM customer_classification_rules newer
    WHERE newer.code = current.code
      AND newer.detector_version > 4
  );

DO $$
DECLARE
  expected_historical_v3 CONSTANT INTEGER := 144;
  expected_successors CONSTANT INTEGER := 143;
  expected_new_rules CONSTANT INTEGER := 3;
  historical_v3 INTEGER;
  active_successors INTEGER;
  active_new_rules INTEGER;
  active_broad_wheel_cap INTEGER;
  duplicate_active_codes INTEGER;
  corrected_leaf_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO historical_v3
  FROM customer_classification_rules
  WHERE detector_version = 3
    AND is_active = FALSE;

  SELECT COUNT(*)::INTEGER
  INTO active_successors
  FROM customer_classification_rules successor
  WHERE successor.detector_version = 4
    AND successor.is_active = TRUE
    AND EXISTS (
      SELECT 1
      FROM customer_classification_rules historical
      WHERE historical.code = successor.code
        AND historical.detector_version = 3
        AND historical.version + 1 = successor.version
    )
    AND successor.code <> 'WHEEL_CAP_A_EPC40_V1';

  SELECT COUNT(*)::INTEGER
  INTO active_new_rules
  FROM customer_classification_rules
  WHERE detector_version = 4
    AND is_active = TRUE
    AND code = ANY(ARRAY[
      'EXHAUST_EGR_PIPE_A_EPC14_V1',
      'WHEEL_CENTER_CAP_A_EPC40_V1',
      'WHEEL_VALVE_CAP_A_EPC40_V1'
    ]::TEXT[]);

  SELECT COUNT(*)::INTEGER
  INTO active_broad_wheel_cap
  FROM customer_classification_rules
  WHERE code = 'WHEEL_CAP_A_EPC40_V1'
    AND is_active = TRUE;

  SELECT COUNT(*)::INTEGER
  INTO duplicate_active_codes
  FROM (
    SELECT code
    FROM customer_classification_rules
    WHERE is_active = TRUE
    GROUP BY code
    HAVING COUNT(*) > 1
  ) duplicate;

  SELECT COUNT(*)::INTEGER
  INTO corrected_leaf_count
  FROM customer_categories category
  WHERE category.slug = ANY(ARRAY[
    'exhaust-egr', 'exhaust-adblue-scr', 'wheels-valve-caps'
  ]::TEXT[])
    AND category.status = 'ACTIVE'
    AND category.is_active = TRUE
    AND category.is_navigation_visible = FALSE;

  IF historical_v3 <> expected_historical_v3 THEN
    RAISE EXCEPTION 'Expected % historical detector-v3 rules, found %',
      expected_historical_v3, historical_v3;
  END IF;
  IF active_successors <> expected_successors THEN
    RAISE EXCEPTION 'Expected % active detector-v4 successors, found %',
      expected_successors, active_successors;
  END IF;
  IF active_new_rules <> expected_new_rules THEN
    RAISE EXCEPTION 'Expected % new detector-v4 rules, found %',
      expected_new_rules, active_new_rules;
  END IF;
  IF active_broad_wheel_cap <> 0 THEN
    RAISE EXCEPTION 'Broad WHEEL_CAP rule must remain historical only';
  END IF;
  IF duplicate_active_codes <> 0 THEN
    RAISE EXCEPTION 'Found % rule codes with multiple active versions',
      duplicate_active_codes;
  END IF;
  IF corrected_leaf_count <> 3 THEN
    RAISE EXCEPTION 'Expected 3 active hidden correction leaves, found %',
      corrected_leaf_count;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('091_tighten_customer_taxonomy_batch2')
ON CONFLICT(version) DO NOTHING;

COMMIT;
