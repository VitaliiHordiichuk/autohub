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

WITH exact_rules(article, category_slug, material_subgroup, notes) AS (
  VALUES
    ('B67660042', 'mb-accessories-interior', 'COAT_HANGER', 'Inspected product: coat hanger'),
    ('B67660114', 'mb-accessories-luggage', 'LUGGAGE_NET', 'Inspected product: luggage net'),
    ('B67870266', 'mb-accessories-collection', 'COLLECTION_APPAREL', 'Inspected Collection apparel'),
    ('B67870429', 'mb-accessories-collection', 'COLLECTION_LIFESTYLE', 'Inspected Collection flashlight'),
    ('B67870476', 'mb-accessories-collection', 'COLLECTION_LIFESTYLE', 'Inspected Collection wall clock'),
    ('B67871178', 'mb-accessories-collection', 'COLLECTION_APPAREL', 'Inspected Collection apparel'),
    ('B67871182', 'mb-accessories-collection', 'COLLECTION_APPAREL', 'Inspected Collection apparel'),
    ('B67871265', 'mb-accessories-collection', 'COLLECTION_APPAREL', 'Inspected Collection apparel'),
    ('B67872159', 'mb-accessories-collection', 'COLLECTION_LIFESTYLE', 'Inspected Collection flashlight'),
    ('B67875707', 'mb-accessories-multimedia', 'MULTIMEDIA', 'Inspected product: loudspeaker'),
    ('B67875709', 'mb-accessories-multimedia', 'MULTIMEDIA', 'Inspected product: FSE additional kit'),
    ('B67875718', 'mb-accessories-multimedia', 'MULTIMEDIA', 'Inspected product: FSE base kit'),
    ('B67875855', 'mb-accessories-multimedia', 'MULTIMEDIA', 'Inspected product: cradle replacement'),
    ('B67881115', 'mb-accessories-multimedia', 'MULTIMEDIA', 'Inspected product: telephone console'),
    ('B67885111', 'mb-accessories-wheels', 'WHEEL_STORAGE', 'Inspected product: wheel bag')
)
INSERT INTO mercedes_accessory_rules(
  article_prefix, article_type, match_type, material_subgroup,
  category_id, priority, confidence, active, notes
)
SELECT exact_rules.article, 'B6', 'EXACT', exact_rules.material_subgroup,
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

CREATE OR REPLACE FUNCTION classify_mercedes_accessory_category(target_product_id INTEGER)
RETURNS VOID AS $$
DECLARE
  target_product products%ROWTYPE;
  normalized_article TEXT;
  selected_category INTEGER;
  selected_confidence NUMERIC(5,2);
  is_mercedes BOOLEAN := FALSE;
BEGIN
  SELECT * INTO target_product FROM products WHERE id = target_product_id;
  IF target_product.id IS NULL THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM product_categories
    WHERE product_id = target_product_id AND assignment_source = 'MANUAL'
  ) THEN
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

  SELECT rule.category_id, rule.confidence
  INTO selected_category, selected_confidence
  FROM mercedes_accessory_rules rule
  JOIN categories category ON category.id = rule.category_id AND category.is_active = TRUE
  WHERE rule.active = TRUE
    AND (
      (rule.article_type = 'A' AND normalized_article LIKE 'A%')
      OR (rule.article_type = 'B6' AND normalized_article LIKE 'B6%')
    )
    AND (
      (rule.match_type = 'EXACT' AND normalized_article = rule.article_prefix)
      OR (rule.match_type = 'PREFIX' AND normalized_article LIKE rule.article_prefix || '%')
    )
  ORDER BY
    rule.priority,
    CASE WHEN rule.match_type = 'EXACT' THEN 0 ELSE 1 END,
    LENGTH(rule.article_prefix) DESC,
    rule.id
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
  is_mercedes BOOLEAN := FALSE;
BEGIN
  SELECT * INTO target_product FROM products WHERE id = target_product_id;
  IF target_product.id IS NULL THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM product_categories
    WHERE product_id = target_product_id AND assignment_source = 'MANUAL'
  ) THEN
    DELETE FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source IN ('AUTO_RULE', 'ACCESSORY_RULE');
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

-- Reclassify only Mercedes B products. Existing MANUAL assignments are
-- explicitly preserved by classify_product_category.
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

GRANT SELECT ON mercedes_accessory_rules TO autohub_app;
GRANT EXECUTE ON FUNCTION classify_mercedes_accessory_category(INTEGER) TO autohub_app;
GRANT EXECUTE ON FUNCTION classify_product_category(INTEGER) TO autohub_app;
GRANT EXECUTE ON FUNCTION apply_catalog_assignment_overrides(INTEGER) TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('076_classify_mercedes_accessories')
ON CONFLICT(version) DO NOTHING;

COMMIT;
