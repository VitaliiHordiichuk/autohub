BEGIN;

-- Preserve the established URL while turning the former catch-all B bucket
-- into the parent of the customer-facing Mercedes-Benz accessory taxonomy.
UPDATE categories
SET name = 'Оригинальные аксессуары Mercedes-Benz',
    name_uk = 'Оригінальні аксесуари Mercedes-Benz',
    name_ru = 'Оригинальные аксессуары Mercedes-Benz',
    name_en = 'Genuine Mercedes-Benz accessories',
    sort_order = 1,
    is_active = TRUE
WHERE slug = 'mb-accessories-b';

WITH accessory_categories(slug, name_uk, name_ru, name_en, sort_order) AS (
  VALUES
    ('mb-accessories-floor-mats', 'Килимки та захист салону', 'Коврики и защита салона', 'Floor mats and interior protection', 10),
    ('mb-accessories-luggage', 'Багаж та перевезення', 'Багаж и перевозка', 'Luggage and transport', 20),
    ('mb-accessories-children', 'Дитячі крісла та аксесуари', 'Детские кресла и аксессуары', 'Child seats and accessories', 30),
    ('mb-accessories-wheels', 'Колеса та аксесуари', 'Колёса и аксессуары', 'Wheels and accessories', 40),
    ('mb-accessories-interior', 'Салон і комфорт', 'Салон и комфорт', 'Interior and comfort', 50),
    ('mb-accessories-exterior', 'Екстер’єр та стилізація', 'Экстерьер и стилизация', 'Exterior and styling', 60),
    ('mb-accessories-multimedia', 'Мультимедіа та електроніка', 'Мультимедиа и электроника', 'Multimedia and electronics', 70),
    ('mb-accessories-safety', 'Безпека', 'Безопасность', 'Safety', 80),
    ('mb-accessories-care', 'Догляд за автомобілем', 'Уход за автомобилем', 'Car care', 90),
    ('mb-accessories-collection', 'Mercedes-Benz Collection', 'Mercedes-Benz Collection', 'Mercedes-Benz Collection', 100),
    ('mb-accessories-travel', 'Подорожі та комфорт', 'Путешествия и комфорт', 'Travel and comfort', 110),
    ('mb-accessories-other', 'Інше', 'Другое', 'Other accessories', 1000)
)
INSERT INTO categories(parent_id, name, name_uk, name_ru, name_en, slug, sort_order, is_active)
SELECT parent.id, accessory_categories.name_ru, accessory_categories.name_uk,
       accessory_categories.name_ru, accessory_categories.name_en,
       accessory_categories.slug, accessory_categories.sort_order, TRUE
FROM accessory_categories
JOIN categories parent ON parent.slug = 'mb-accessories-b'
ON CONFLICT(slug) WHERE slug IS NOT NULL
DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  name = EXCLUDED.name,
  name_uk = EXCLUDED.name_uk,
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

CREATE TABLE IF NOT EXISTS mercedes_accessory_rules (
  id SERIAL PRIMARY KEY,
  article_prefix TEXT NOT NULL,
  article_type VARCHAR(10) NOT NULL,
  match_type VARCHAR(10) NOT NULL DEFAULT 'PREFIX',
  material_subgroup TEXT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 100,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mercedes_accessory_rules_article_type_check
    CHECK (article_type IN ('A', 'B6')),
  CONSTRAINT mercedes_accessory_rules_match_type_check
    CHECK (match_type IN ('PREFIX', 'EXACT')),
  CONSTRAINT mercedes_accessory_rules_a_exact_only_check
    CHECK (article_type <> 'A' OR match_type = 'EXACT'),
  CONSTRAINT mercedes_accessory_rules_prefix_check
    CHECK (article_prefix = REGEXP_REPLACE(UPPER(article_prefix), '[^A-Z0-9]', '', 'g')),
  CONSTRAINT mercedes_accessory_rules_confidence_check
    CHECK (confidence >= 0 AND confidence <= 100)
);

-- One normalized prefix/exact article can point to only one semantic category.
-- Without this guard two active rules could silently compete by id.
DROP INDEX IF EXISTS mercedes_accessory_rules_identity_unique;
CREATE UNIQUE INDEX mercedes_accessory_rules_identity_unique
  ON mercedes_accessory_rules(article_type, match_type, article_prefix);

WITH prefix_rules(article_prefix, category_slug, material_subgroup, notes) AS (
  VALUES
    ('B6604', 'mb-accessories-collection', 'COLLECTION', '40 inspected products; models and lifestyle goods'),
    ('B6645', 'mb-accessories-collection', 'COLLECTION', '11 inspected products; lifestyle and mobility goods'),
    ('B6695', 'mb-accessories-collection', 'COLLECTION', '98 inspected products; Mercedes-Benz Collection'),
    ('B6696', 'mb-accessories-collection', 'COLLECTION', '14 inspected products; scale models and Collection'),
    ('B6796', 'mb-accessories-collection', 'COLLECTION', '9 inspected products; Mercedes-Benz Collection'),
    ('B6799', 'mb-accessories-collection', 'COLLECTION', '18 inspected products; apparel and Collection'),

    ('B6603', 'mb-accessories-floor-mats', 'FLOOR_MATS', 'Inspected velour mat family'),
    ('B6629', 'mb-accessories-floor-mats', 'FLOOR_MATS', 'Inspected velour mat family'),
    ('B6635', 'mb-accessories-floor-mats', 'FLOOR_MATS', 'Inspected rib mat family'),
    ('B6636', 'mb-accessories-floor-mats', 'FLOOR_MATS', 'Inspected rib mat family'),
    ('B6656', 'mb-accessories-floor-mats', 'INTERIOR_PROTECTION', 'Inspected mats and workshop interior protection'),
    ('B6668', 'mb-accessories-floor-mats', 'FLOOR_MATS', 'Inspected rubber mat family'),
    ('B6768', 'mb-accessories-floor-mats', 'FLOOR_MATS', 'Inspected velour mat family'),

    ('B6647', 'mb-accessories-wheels', 'WHEELS', 'Inspected wheels, hub caps and valve caps'),
    ('B6781', 'mb-accessories-wheels', 'WHEEL_SECURITY', 'Inspected wheel lock key family'),

    ('B6652', 'mb-accessories-exterior', 'MUD_FLAPS', 'Inspected mud flap family'),
    ('B6664', 'mb-accessories-exterior', 'LOAD_SILL_PROTECTION', 'Inspected load sill protection family'),
    ('B6688', 'mb-accessories-exterior', 'EXTERIOR_TRIM', 'Inspected handles, mirrors and exterior trim'),
    ('B6689', 'mb-accessories-exterior', 'EXTERIOR_TRIM', 'Inspected sill trim family')
)
INSERT INTO mercedes_accessory_rules(
  article_prefix, article_type, match_type, material_subgroup,
  category_id, priority, confidence, active, notes
)
SELECT prefix_rules.article_prefix, 'B6', 'PREFIX', prefix_rules.material_subgroup,
       category.id, 100, 100, TRUE, prefix_rules.notes
FROM prefix_rules
JOIN categories category ON category.slug = prefix_rules.category_slug
ON CONFLICT(article_type, match_type, article_prefix)
DO UPDATE SET
  category_id = EXCLUDED.category_id,
  material_subgroup = EXCLUDED.material_subgroup,
  priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence,
  active = TRUE,
  notes = EXCLUDED.notes,
  updated_at = CURRENT_TIMESTAMP;

WITH exact_rules(article, article_type, category_slug, material_subgroup, notes) AS (
  VALUES
    ('A2046804348', 'A', 'mb-accessories-floor-mats', 'FLOOR_MATS', 'Verified A accessory example: floor mat'),
    ('A1648990640', 'A', 'mb-accessories-exterior', 'MUD_FLAPS', 'Verified genuine Mercedes-Benz mud-flap accessory'),
    ('A1768900178', 'A', 'mb-accessories-exterior', 'MUD_FLAPS', 'Verified genuine Mercedes-Benz mud-flap accessory'),
    ('A4478900000', 'A', 'mb-accessories-exterior', 'MUD_FLAPS', 'Verified genuine Mercedes-Benz mud-flap accessory'),
    ('A4478900100', 'A', 'mb-accessories-exterior', 'MUD_FLAPS', 'Verified genuine Mercedes-Benz mud-flap accessory'),
    ('B67660042', 'B6', 'mb-accessories-interior', 'COAT_HANGER', 'Inspected product: coat hanger'),
    ('B67660114', 'B6', 'mb-accessories-luggage', 'LUGGAGE_NET', 'Inspected product: luggage net'),
    ('B67870266', 'B6', 'mb-accessories-collection', 'COLLECTION_APPAREL', 'Inspected Collection apparel'),
    ('B67870429', 'B6', 'mb-accessories-collection', 'COLLECTION_LIFESTYLE', 'Inspected Collection flashlight'),
    ('B67870476', 'B6', 'mb-accessories-collection', 'COLLECTION_LIFESTYLE', 'Inspected Collection wall clock'),
    ('B67871178', 'B6', 'mb-accessories-collection', 'COLLECTION_APPAREL', 'Inspected Collection apparel'),
    ('B67871182', 'B6', 'mb-accessories-collection', 'COLLECTION_APPAREL', 'Inspected Collection apparel'),
    ('B67871265', 'B6', 'mb-accessories-collection', 'COLLECTION_APPAREL', 'Inspected Collection apparel'),
    ('B67872159', 'B6', 'mb-accessories-collection', 'COLLECTION_LIFESTYLE', 'Inspected Collection flashlight'),
    ('B67875707', 'B6', 'mb-accessories-multimedia', 'MULTIMEDIA', 'Inspected product: loudspeaker'),
    ('B67875709', 'B6', 'mb-accessories-multimedia', 'MULTIMEDIA', 'Inspected product: FSE additional kit'),
    ('B67875718', 'B6', 'mb-accessories-multimedia', 'MULTIMEDIA', 'Inspected product: FSE base kit'),
    ('B67875855', 'B6', 'mb-accessories-multimedia', 'MULTIMEDIA', 'Inspected product: cradle replacement'),
    ('B67881115', 'B6', 'mb-accessories-multimedia', 'MULTIMEDIA', 'Inspected product: telephone console'),
    ('B67885111', 'B6', 'mb-accessories-wheels', 'WHEEL_STORAGE', 'Inspected product: wheel bag')
)
INSERT INTO mercedes_accessory_rules(
  article_prefix, article_type, match_type, material_subgroup,
  category_id, priority, confidence, active, notes
)
SELECT exact_rules.article, exact_rules.article_type, 'EXACT', exact_rules.material_subgroup,
       category.id, 10, 100, TRUE, exact_rules.notes
FROM exact_rules
JOIN categories category ON category.slug = exact_rules.category_slug
ON CONFLICT(article_type, match_type, article_prefix)
DO UPDATE SET
  category_id = EXCLUDED.category_id,
  material_subgroup = EXCLUDED.material_subgroup,
  priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence,
  active = TRUE,
  notes = EXCLUDED.notes,
  updated_at = CURRENT_TIMESTAMP;

-- A-numbers cannot be recognized as accessories from their Mercedes major
-- group alone. These deliberately narrow name rules are a separate,
-- high-confidence source and can be extended without changing the classifier.
CREATE TABLE IF NOT EXISTS mercedes_accessory_name_rules (
  id SERIAL PRIMARY KEY,
  article_type VARCHAR(10) NOT NULL DEFAULT 'A',
  name_pattern TEXT NOT NULL,
  material_subgroup TEXT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 200,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 95,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mercedes_accessory_name_rules_article_type_check
    CHECK (article_type = 'A'),
  CONSTRAINT mercedes_accessory_name_rules_pattern_check
    CHECK (BTRIM(name_pattern) <> ''),
  CONSTRAINT mercedes_accessory_name_rules_confidence_check
    CHECK (confidence >= 90 AND confidence <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS mercedes_accessory_name_rules_identity_unique
  ON mercedes_accessory_name_rules(article_type, name_pattern);

-- Mud-flap wording is ambiguous for A articles: it is also used for regular
-- wheel-arch and fender body parts. Those products are accessories only when
-- their complete article number is present in the verified exact rules above.
DELETE FROM mercedes_accessory_name_rules
WHERE article_type = 'A'
  AND material_subgroup = 'MUD_FLAPS';

WITH name_rules(name_pattern, category_slug, material_subgroup, priority, notes) AS (
  VALUES
    ('^[[:space:]]*(килим(ок|ки)?|коврик(и)?)[[:space:]]+багаж', 'mb-accessories-luggage', 'LUGGAGE_MAT', 100, 'High-confidence luggage-compartment mat name'),
    ('^[[:space:]]*(піддон|поддон|лоток)[[:space:]]+(для[[:space:]]+)?багаж', 'mb-accessories-luggage', 'LUGGAGE_TRAY', 110, 'High-confidence luggage-compartment tray name'),
    ('^[[:space:]]*(сітка|сетка)[[:space:]]+багаж', 'mb-accessories-luggage', 'LUGGAGE_NET', 120, 'High-confidence luggage net name'),
    ('^[[:space:]]*багажник[[:space:]]+(зовнішн|внешн|на[[:space:]]+(дах|крыш))', 'mb-accessories-luggage', 'ROOF_CARRIER', 130, 'High-confidence roof carrier name'),
    ('^[[:space:]]*((килимки|коврики|floor[[:space:]-]*mats?)([[:space:][:punct:]]|$)|(килимок|коврик)[[:space:]]+(салон|підлог|пола|тунел|гумов|резин|текстил|воді|водит|пасаж|пассаж))', 'mb-accessories-floor-mats', 'FLOOR_MATS', 200, 'High-confidence floor mat name with a plural or an interior qualifier'),
    ('^[[:space:]]*(дитяче|детское|child)[[:space:]-]+(авто)?(крісло|кресло|seat)', 'mb-accessories-children', 'CHILD_SEAT', 220, 'High-confidence child seat name'),
    ('^[[:space:]]*(чохол|чехол|bag)[[:space:]]+(для[[:space:]]+)?(запасного[[:space:]]+)?колес', 'mb-accessories-wheels', 'WHEEL_STORAGE', 230, 'High-confidence wheel cover or bag name'),
    ('^[[:space:]]*(вішалка|вешалка|coat[[:space:]-]*hanger)([[:space:][:punct:]]|$)', 'mb-accessories-interior', 'COAT_HANGER', 240, 'High-confidence coat hanger name')
)
INSERT INTO mercedes_accessory_name_rules(
  article_type, name_pattern, material_subgroup, category_id,
  priority, confidence, active, notes
)
SELECT 'A', name_rules.name_pattern, name_rules.material_subgroup,
       category.id, name_rules.priority, 95, TRUE, name_rules.notes
FROM name_rules
JOIN categories category ON category.slug = name_rules.category_slug
ON CONFLICT(article_type, name_pattern)
DO UPDATE SET
  category_id = EXCLUDED.category_id,
  material_subgroup = EXCLUDED.material_subgroup,
  priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence,
  active = TRUE,
  notes = EXCLUDED.notes,
  updated_at = CURRENT_TIMESTAMP;

-- Taxonomy priority is evaluated independently for the functional catalogue
-- and for the dedicated Mercedes accessory tree.
CREATE OR REPLACE FUNCTION category_is_within_tree(
  target_category_id INTEGER,
  target_root_slug TEXT
)
RETURNS BOOLEAN AS $$
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id, slug
    FROM categories
    WHERE id = target_category_id
    UNION ALL
    SELECT parent.id, parent.parent_id, parent.slug
    FROM categories parent
    JOIN ancestors child ON child.parent_id = parent.id
  )
  SELECT EXISTS (
    SELECT 1 FROM ancestors WHERE slug = target_root_slug
  );
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION classify_mercedes_accessory_category(target_product_id INTEGER)
RETURNS VOID AS $$
DECLARE
  target_product products%ROWTYPE;
  normalized_article TEXT;
  selected_category INTEGER;
  selected_confidence NUMERIC(5,2);
  has_manual_accessory BOOLEAN := FALSE;
  is_mercedes BOOLEAN := FALSE;
BEGIN
  SELECT * INTO target_product FROM products WHERE id = target_product_id;
  IF target_product.id IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source = 'MANUAL'
      AND category_is_within_tree(category_id, 'mb-accessories-b')
  ) INTO has_manual_accessory;

  -- A manual choice inside the accessory tree overrides only this taxonomy.
  -- It must not block or remove the independent functional assignment.
  IF has_manual_accessory THEN
    DELETE FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source = 'ACCESSORY_RULE';
    RETURN;
  END IF;

  SELECT (
    EXISTS (
      SELECT 1 FROM brands brand
      WHERE brand.id = target_product.brand_id
        AND LOWER(brand.name) LIKE '%mercedes%'
    )
    OR EXISTS (
      SELECT 1 FROM part_manufacturers manufacturer
      WHERE manufacturer.id = target_product.manufacturer_id
        AND LOWER(manufacturer.name) LIKE '%mercedes%'
    )
  ) INTO is_mercedes;

  DELETE FROM product_categories
  WHERE product_id = target_product_id
    AND assignment_source = 'ACCESSORY_RULE';

  IF NOT is_mercedes THEN RETURN; END IF;

  normalized_article := REGEXP_REPLACE(
    UPPER(COALESCE(target_product.article_normalized, target_product.article, '')),
    '[^A-Z0-9]', '', 'g'
  );

  SELECT candidate.category_id, candidate.confidence
  INTO selected_category, selected_confidence
  FROM (
    SELECT
      rule.category_id,
      rule.confidence,
      rule.priority,
      CASE WHEN rule.match_type = 'EXACT' THEN 0 ELSE 1 END AS source_order,
      LENGTH(rule.article_prefix) AS specificity,
      rule.id
    FROM mercedes_accessory_rules rule
    JOIN categories category
      ON category.id = rule.category_id
      AND category.is_active = TRUE
    WHERE rule.active = TRUE
      AND (
        (rule.article_type = 'A' AND normalized_article LIKE 'A%')
        OR (rule.article_type = 'B6' AND normalized_article LIKE 'B6%')
      )
      AND (
        (rule.match_type = 'EXACT' AND normalized_article = rule.article_prefix)
        OR (rule.match_type = 'PREFIX' AND normalized_article LIKE rule.article_prefix || '%')
      )

    UNION ALL

    SELECT
      name_rule.category_id,
      name_rule.confidence,
      name_rule.priority,
      2 AS source_order,
      LENGTH(name_rule.name_pattern) AS specificity,
      name_rule.id
    FROM mercedes_accessory_name_rules name_rule
    JOIN categories category
      ON category.id = name_rule.category_id
      AND category.is_active = TRUE
    WHERE name_rule.active = TRUE
      AND name_rule.article_type = 'A'
      AND normalized_article LIKE 'A%'
      AND COALESCE(target_product.name, '') ~* name_rule.name_pattern
  ) candidate
  ORDER BY
    candidate.priority,
    candidate.source_order,
    candidate.specificity DESC,
    candidate.id
  LIMIT 1;

  IF selected_category IS NULL AND normalized_article LIKE 'B6%' THEN
    SELECT id INTO selected_category
    FROM categories
    WHERE slug = 'mb-accessories-other' AND is_active = TRUE
    LIMIT 1;
    selected_confidence := 0;
  END IF;

  IF selected_category IS NOT NULL THEN
    INSERT INTO product_categories(product_id, category_id, assignment_source, confidence)
    VALUES(target_product_id, selected_category, 'ACCESSORY_RULE', selected_confidence)
    ON CONFLICT(product_id, category_id)
    DO UPDATE SET
      assignment_source = 'ACCESSORY_RULE',
      confidence = EXCLUDED.confidence;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION classify_product_category(target_product_id INTEGER)
RETURNS VOID AS $$
DECLARE
  target_product products%ROWTYPE;
  normalized_article TEXT;
  selected_category INTEGER;
  selected_confidence NUMERIC(5,2) := 90;
  has_manual_functional BOOLEAN := FALSE;
  is_mercedes BOOLEAN := FALSE;
BEGIN
  SELECT * INTO target_product FROM products WHERE id = target_product_id;
  IF target_product.id IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source = 'MANUAL'
      AND NOT category_is_within_tree(category_id, 'mb-accessories-b')
  ) INTO has_manual_functional;

  -- A functional manual choice overrides only AUTO_RULE. Accessory
  -- classification remains independent and is still refreshed below.
  IF has_manual_functional THEN
    DELETE FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source = 'AUTO_RULE';
    PERFORM classify_mercedes_accessory_category(target_product_id);
    RETURN;
  END IF;

  SELECT (
    EXISTS (
      SELECT 1 FROM brands brand
      WHERE brand.id = target_product.brand_id
        AND LOWER(brand.name) LIKE '%mercedes%'
    )
    OR EXISTS (
      SELECT 1 FROM part_manufacturers manufacturer
      WHERE manufacturer.id = target_product.manufacturer_id
        AND LOWER(manufacturer.name) LIKE '%mercedes%'
    )
  ) INTO is_mercedes;

  normalized_article := REGEXP_REPLACE(
    UPPER(COALESCE(target_product.article_normalized, target_product.article, '')),
    '[^A-Z0-9]', '', 'g'
  );

  IF is_mercedes THEN
    IF normalized_article ~ '^A[0-9]{10}' THEN
      SELECT rule.category_id INTO selected_category
      FROM mercedes_catalog_group_rules rule
      JOIN categories category ON category.id = rule.category_id AND category.is_active = TRUE
      WHERE rule.group_code = SUBSTRING(normalized_article FROM 5 FOR 2)
      LIMIT 1;
      selected_confidence := 100;
    END IF;

    -- B6 is classified only in the accessory taxonomy. Other Mercedes
    -- articles without a known functional group keep the general fallback.
    IF selected_category IS NULL AND normalized_article NOT LIKE 'B6%' THEN
      SELECT id INTO selected_category
      FROM categories WHERE slug = 'other' AND is_active = TRUE LIMIT 1;
      selected_confidence := 0;
    END IF;
  ELSE
    SELECT rule.category_id INTO selected_category
    FROM category_classification_rules rule
    JOIN categories category ON category.id = rule.category_id AND category.is_active = TRUE
    WHERE rule.is_active = TRUE AND target_product.name ~* rule.pattern
    ORDER BY rule.priority, rule.id
    LIMIT 1;
  END IF;

  DELETE FROM product_categories
  WHERE product_id = target_product_id AND assignment_source = 'AUTO_RULE';

  IF selected_category IS NOT NULL THEN
    INSERT INTO product_categories(product_id, category_id, assignment_source, confidence)
    VALUES(target_product_id, selected_category, 'AUTO_RULE', selected_confidence)
    ON CONFLICT(product_id, category_id)
    DO UPDATE SET assignment_source = 'AUTO_RULE', confidence = EXCLUDED.confidence;
  END IF;

  PERFORM classify_mercedes_accessory_category(target_product_id);
END;
$$ LANGUAGE plpgsql;

-- Compatibility wrapper retained for existing application code.
CREATE OR REPLACE FUNCTION apply_catalog_assignment_overrides(target_product_id INTEGER)
RETURNS VOID AS $$
BEGIN
  PERFORM classify_mercedes_accessory_category(target_product_id);
END;
$$ LANGUAGE plpgsql;

-- B/B6 products need the complete refresh because the previous classifier
-- placed all B articles in one bucket. Manual priority is taxonomy-scoped.
SELECT classify_product_category(product.id)
FROM products product
WHERE (
  EXISTS (
    SELECT 1 FROM brands brand
    WHERE brand.id = product.brand_id AND LOWER(brand.name) LIKE '%mercedes%'
  )
  OR EXISTS (
    SELECT 1 FROM part_manufacturers manufacturer
    WHERE manufacturer.id = product.manufacturer_id
      AND LOWER(manufacturer.name) LIKE '%mercedes%'
  )
)
AND REGEXP_REPLACE(
  UPPER(COALESCE(product.article_normalized, product.article, '')),
  '[^A-Z0-9]', '', 'g'
) LIKE 'B%';

-- Existing A products keep their functional Mercedes category. Only A rows
-- with a verified exact article or a high-confidence name rule receive the
-- additional accessory assignment.
SELECT classify_mercedes_accessory_category(product.id)
FROM products product
WHERE (
  EXISTS (
    SELECT 1 FROM brands brand
    WHERE brand.id = product.brand_id AND LOWER(brand.name) LIKE '%mercedes%'
  )
  OR EXISTS (
    SELECT 1 FROM part_manufacturers manufacturer
    WHERE manufacturer.id = product.manufacturer_id
      AND LOWER(manufacturer.name) LIKE '%mercedes%'
  )
)
AND REGEXP_REPLACE(
  UPPER(COALESCE(product.article_normalized, product.article, '')),
  '[^A-Z0-9]', '', 'g'
) LIKE 'A%'
AND (
  EXISTS (
    SELECT 1
    FROM mercedes_accessory_rules rule
    WHERE rule.active = TRUE
      AND rule.article_type = 'A'
      AND rule.match_type = 'EXACT'
      AND rule.article_prefix = REGEXP_REPLACE(
        UPPER(COALESCE(product.article_normalized, product.article, '')),
        '[^A-Z0-9]', '', 'g'
      )
  )
  OR EXISTS (
    SELECT 1
    FROM mercedes_accessory_name_rules name_rule
    WHERE name_rule.active = TRUE
      AND name_rule.article_type = 'A'
      AND COALESCE(product.name, '') ~* name_rule.name_pattern
  )
);

GRANT SELECT ON mercedes_accessory_rules TO autohub_app;
GRANT SELECT ON mercedes_accessory_name_rules TO autohub_app;
GRANT EXECUTE ON FUNCTION category_is_within_tree(INTEGER, TEXT) TO autohub_app;
GRANT EXECUTE ON FUNCTION classify_mercedes_accessory_category(INTEGER) TO autohub_app;
GRANT EXECUTE ON FUNCTION classify_product_category(INTEGER) TO autohub_app;
GRANT EXECUTE ON FUNCTION apply_catalog_assignment_overrides(INTEGER) TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('076_classify_mercedes_accessories')
ON CONFLICT(version) DO NOTHING;

COMMIT;
