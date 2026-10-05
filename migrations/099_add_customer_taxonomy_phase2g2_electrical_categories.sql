BEGIN;

-- PHASE 2G.2 adds only reviewed Electrical/Electronics/Lighting leaves.
-- All leaves remain hidden until a later storefront phase enables them.
WITH leaf(parent_slug, slug, sort_order, name_uk, name_ru, name_en) AS (
  VALUES
    ('electrical-electronics-lighting', 'electrical-control-units', 10, 'Блоки керування та модулі', 'Блоки управления и модули', 'Control units & modules'),
    ('electrical-electronics-lighting', 'electrical-wiring-harnesses', 20, 'Джгути та проводка', 'Жгуты и проводка', 'Wiring harnesses'),
    ('electrical-electronics-lighting', 'lighting-headlights', 30, 'Передні фари', 'Передние фары', 'Headlights'),
    ('electrical-electronics-lighting', 'electrical-connectors-plugs', 40, 'Роз''єми та штекери', 'Разъёмы и штекеры', 'Connectors & plugs'),
    ('electrical-electronics-lighting', 'electrical-sensors', 50, 'Електричні датчики', 'Электрические датчики', 'Electrical sensors'),
    ('electrical-electronics-lighting', 'electrical-fuse-boxes', 60, 'Блоки запобіжників', 'Блоки предохранителей', 'Fuse boxes'),
    ('electrical-electronics-lighting', 'electrical-switches-controls', 70, 'Перемикачі та кнопки', 'Переключатели и кнопки', 'Switches & controls'),
    ('electrical-electronics-lighting', 'electrical-batteries', 80, 'Акумулятори', 'Аккумуляторы', 'Batteries'),
    ('electrical-electronics-lighting', 'electrical-cameras', 90, 'Камери', 'Камеры', 'Cameras'),
    ('electrical-electronics-lighting', 'electrical-parking-sensors', 100, 'Датчики паркування', 'Датчики парковки', 'Parking sensors'),
    ('electrical-electronics-lighting', 'electrical-relays', 110, 'Реле', 'Реле', 'Relays'),
    ('electrical-electronics-lighting', 'electrical-alternators', 120, 'Генератори', 'Генераторы', 'Alternators'),
    ('electrical-electronics-lighting', 'electrical-antennas', 130, 'Антени', 'Антенны', 'Antennas'),
    ('electrical-electronics-lighting', 'electrical-fuses', 140, 'Запобіжники', 'Предохранители', 'Fuses'),
    ('electrical-electronics-lighting', 'lighting-fog-lights', 150, 'Протитуманні фари', 'Противотуманные фары', 'Fog lights'),
    ('electrical-electronics-lighting', 'electrical-driver-assistance', 160, 'Радари та асистенти', 'Радары и ассистенты', 'Driver-assistance electronics'),
    ('electrical-electronics-lighting', 'electrical-starters', 170, 'Стартери', 'Стартеры', 'Starters'),
    ('electrical-electronics-lighting', 'electrical-infotainment', 180, 'Мультимедіа та зв''язок', 'Мультимедиа и связь', 'Infotainment electronics'),
    ('electrical-electronics-lighting', 'lighting-bulbs', 190, 'Лампи', 'Лампы', 'Bulbs & lamps')
), upserted AS (
  INSERT INTO customer_categories(
    slug, parent_id, status, is_active, is_navigation_visible, sort_order
  )
  SELECT leaf.slug, parent.id, 'ACTIVE', TRUE, FALSE, leaf.sort_order
  FROM leaf
  JOIN customer_categories parent ON parent.slug = leaf.parent_slug
  ON CONFLICT (slug) DO UPDATE SET
    parent_id = EXCLUDED.parent_id, status = 'ACTIVE', is_active = TRUE,
    is_navigation_visible = FALSE, sort_order = EXCLUDED.sort_order, updated_at = NOW()
  RETURNING id, slug
)
INSERT INTO customer_category_translations(category_id, language_code, name)
SELECT category.id, translation.language_code, translation.name
FROM leaf source
JOIN upserted category ON category.slug = source.slug
CROSS JOIN LATERAL (VALUES
  ('uk', source.name_uk), ('ru', source.name_ru), ('en', source.name_en)
) translation(language_code, name)
ON CONFLICT (category_id, language_code) DO UPDATE SET
  name = EXCLUDED.name, updated_at = NOW();

DO $$
DECLARE
  expected_leaf_count CONSTANT INTEGER := 19;
  actual_leaf_count INTEGER;
  translation_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO actual_leaf_count
  FROM customer_categories category
  JOIN customer_categories parent ON parent.id = category.parent_id
  WHERE category.slug = ANY(ARRAY[
      'electrical-control-units',
      'electrical-wiring-harnesses',
      'lighting-headlights',
      'electrical-connectors-plugs',
      'electrical-sensors',
      'electrical-fuse-boxes',
      'electrical-switches-controls',
      'electrical-batteries',
      'electrical-cameras',
      'electrical-parking-sensors',
      'electrical-relays',
      'electrical-alternators',
      'electrical-antennas',
      'electrical-fuses',
      'lighting-fog-lights',
      'electrical-driver-assistance',
      'electrical-starters',
      'electrical-infotainment',
      'lighting-bulbs'
    ]::TEXT[])
    AND category.status = 'ACTIVE'
    AND category.is_active = TRUE
    AND category.is_navigation_visible = FALSE
    AND parent.slug = 'electrical-electronics-lighting';

  SELECT COUNT(*)::INTEGER INTO translation_count
  FROM customer_category_translations translation
  JOIN customer_categories category ON category.id = translation.category_id
  WHERE category.slug = ANY(ARRAY[
      'electrical-control-units',
      'electrical-wiring-harnesses',
      'lighting-headlights',
      'electrical-connectors-plugs',
      'electrical-sensors',
      'electrical-fuse-boxes',
      'electrical-switches-controls',
      'electrical-batteries',
      'electrical-cameras',
      'electrical-parking-sensors',
      'electrical-relays',
      'electrical-alternators',
      'electrical-antennas',
      'electrical-fuses',
      'lighting-fog-lights',
      'electrical-driver-assistance',
      'electrical-starters',
      'electrical-infotainment',
      'lighting-bulbs'
    ]::TEXT[])
    AND translation.language_code IN ('uk','ru','en');

  IF actual_leaf_count <> expected_leaf_count THEN
    RAISE EXCEPTION 'Expected % PHASE 2G.2 leaves, found %', expected_leaf_count, actual_leaf_count;
  END IF;
  IF translation_count <> expected_leaf_count * 3 THEN
    RAISE EXCEPTION 'Expected % PHASE 2G.2 translations, found %', expected_leaf_count * 3, translation_count;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version) VALUES ('099_add_customer_taxonomy_phase2g2_electrical_categories')
ON CONFLICT(version) DO NOTHING;

COMMIT;
