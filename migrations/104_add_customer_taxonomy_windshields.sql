BEGIN;

WITH upserted AS (
  INSERT INTO customer_categories(
    slug, parent_id, status, is_active, is_navigation_visible, sort_order
  )
  SELECT
    'body-windshields',
    parent.id,
    'ACTIVE',
    TRUE,
    FALSE,
    105
  FROM customer_categories parent
  WHERE parent.slug = 'body-glass'
    AND parent.status = 'ACTIVE'
    AND parent.is_active = TRUE
  ON CONFLICT (slug) DO UPDATE SET
    parent_id = EXCLUDED.parent_id,
    status = 'ACTIVE',
    is_active = TRUE,
    is_navigation_visible = FALSE,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW()
  RETURNING id
)
INSERT INTO customer_category_translations(category_id, language_code, name)
SELECT category.id, translation.language_code, translation.name
FROM upserted category
CROSS JOIN LATERAL (VALUES
  ('uk', 'Лобове скло'),
  ('ru', 'Лобовые стёкла'),
  ('en', 'Windshields')
) translation(language_code, name)
ON CONFLICT (category_id, language_code) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();

-- Detector v10 preserves every v9 rule row for historical memberships and
-- creates field-identical active successors for future classifications.
INSERT INTO customer_classification_rules(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value, exclude_values,
  target_category_id, priority, confidence, auto_approval_allowed, is_active
)
SELECT
  previous.code,
  previous.version + 1,
  10,
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
WHERE previous.detector_version = 9
  AND previous.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM customer_classification_rules newer
    WHERE newer.code = previous.code
      AND newer.detector_version > 9
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
SET is_active = FALSE, updated_at = NOW()
WHERE detector_version = 9
  AND is_active = TRUE;

WITH target AS (
  SELECT id
  FROM customer_categories
  WHERE slug = 'body-windshields'
    AND status = 'ACTIVE'
    AND is_active = TRUE
)
INSERT INTO customer_classification_rules(
  code, version, detector_version, source_kind, assignment_role,
  number_family, epc_group, match_type, match_value, exclude_values,
  target_category_id, priority, confidence, auto_approval_allowed, is_active
)
SELECT
  'GLASS_WINDSHIELD_A_EPC67_V1',
  1,
  10,
  'RULE',
  'PRIMARY',
  'A',
  '67',
  'TYPE_CODE',
  'GLASS_WINDSHIELD',
  '{}'::TEXT[],
  target.id,
  100,
  'HIGH',
  TRUE,
  FALSE
FROM target
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

UPDATE customer_classification_rules current
SET is_active = TRUE, updated_at = NOW()
WHERE current.detector_version = 10
  AND current.version = (
    SELECT MAX(candidate.version)
    FROM customer_classification_rules candidate
    WHERE candidate.code = current.code
      AND candidate.detector_version = 10
  )
  AND NOT EXISTS (
    SELECT 1
    FROM customer_classification_rules newer
    WHERE newer.code = current.code
      AND newer.detector_version > 10
  );

DO $$
DECLARE
  historical_v9 INTEGER;
  active_v10_successors INTEGER;
  active_v10_total INTEGER;
  duplicate_active_codes INTEGER;
  category_translations INTEGER;
  windshield_rules INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO historical_v9
  FROM customer_classification_rules
  WHERE detector_version = 9
    AND is_active = FALSE;

  SELECT COUNT(*)::INTEGER INTO active_v10_successors
  FROM customer_classification_rules successor
  WHERE successor.detector_version = 10
    AND successor.is_active = TRUE
    AND EXISTS (
      SELECT 1
      FROM customer_classification_rules historical
      WHERE historical.code = successor.code
        AND historical.detector_version = 9
        AND historical.version + 1 = successor.version
    );

  SELECT COUNT(*)::INTEGER INTO active_v10_total
  FROM customer_classification_rules
  WHERE detector_version = 10
    AND is_active = TRUE;

  SELECT COUNT(*)::INTEGER INTO duplicate_active_codes
  FROM (
    SELECT code
    FROM customer_classification_rules
    WHERE is_active = TRUE
    GROUP BY code
    HAVING COUNT(*) > 1
  ) duplicate;

  SELECT COUNT(*)::INTEGER INTO category_translations
  FROM customer_category_translations translation
  JOIN customer_categories category ON category.id = translation.category_id
  JOIN customer_categories parent ON parent.id = category.parent_id
  WHERE category.slug = 'body-windshields'
    AND parent.slug = 'body-glass'
    AND category.status = 'ACTIVE'
    AND category.is_active = TRUE
    AND translation.language_code IN ('uk', 'ru', 'en');

  SELECT COUNT(*)::INTEGER INTO windshield_rules
  FROM customer_classification_rules rule
  JOIN customer_categories category ON category.id = rule.target_category_id
  WHERE rule.code = 'GLASS_WINDSHIELD_A_EPC67_V1'
    AND rule.version = 1
    AND rule.detector_version = 10
    AND rule.is_active = TRUE
    AND rule.source_kind = 'RULE'
    AND rule.assignment_role = 'PRIMARY'
    AND rule.number_family = 'A'
    AND rule.epc_group = '67'
    AND rule.match_type = 'TYPE_CODE'
    AND rule.match_value = 'GLASS_WINDSHIELD'
    AND rule.confidence = 'HIGH'
    AND rule.auto_approval_allowed = TRUE
    AND category.slug = 'body-windshields';

  IF historical_v9 <> 373 THEN
    RAISE EXCEPTION 'Expected 373 historical detector-v9 rules, found %', historical_v9;
  END IF;
  IF active_v10_successors <> 373 THEN
    RAISE EXCEPTION 'Expected 373 active detector-v10 successors, found %', active_v10_successors;
  END IF;
  IF active_v10_total <> 374 THEN
    RAISE EXCEPTION 'Expected 374 active detector-v10 rules, found %', active_v10_total;
  END IF;
  IF duplicate_active_codes <> 0 THEN
    RAISE EXCEPTION 'Found % rule codes with multiple active versions', duplicate_active_codes;
  END IF;
  IF category_translations <> 3 THEN
    RAISE EXCEPTION 'Expected 3 windshield translations, found %', category_translations;
  END IF;
  IF windshield_rules <> 1 THEN
    RAISE EXCEPTION 'Expected one active windshield rule, found %', windshield_rules;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('104_add_customer_taxonomy_windshields')
ON CONFLICT(version) DO NOTHING;

COMMIT;
