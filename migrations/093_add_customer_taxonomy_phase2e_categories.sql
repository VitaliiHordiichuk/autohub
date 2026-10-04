BEGIN;

-- PHASE 2E adds customer-facing leaves only. They remain hidden from public
-- navigation until a later storefront phase explicitly enables them.
WITH leaf(
  parent_slug,
  slug,
  sort_order,
  name_uk,
  name_ru,
  name_en
) AS (
  VALUES
    ('transmission-drivetrain', 'transmission-clutch-components', 10,
      'Компоненти зчеплення', 'Компоненты сцепления', 'Clutch components'),
    ('transmission-drivetrain', 'transmission-selector-linkage', 20,
      'Троси та тяги перемикання передач', 'Тросы и тяги переключения передач', 'Gear selector cables and linkage'),
    ('transmission-drivetrain', 'transmission-oil-filters', 30,
      'Фільтри оливи трансмісії', 'Фильтры масла трансмиссии', 'Transmission oil filters'),
    ('transmission-drivetrain', 'transmission-oil-pans', 40,
      'Піддони трансмісії', 'Поддоны трансмиссии', 'Transmission oil pans'),
    ('transmission-drivetrain', 'transmission-fluid-lines', 50,
      'Трубки та шланги трансмісії', 'Трубки и шланги трансмиссии', 'Transmission fluid lines'),
    ('transmission-drivetrain', 'transmission-valve-bodies', 60,
      'Гідроблоки трансмісії', 'Гидроблоки трансмиссии', 'Transmission valve bodies'),
    ('transmission-drivetrain', 'transmission-seals-gaskets', 70,
      'Прокладки та ущільнення трансмісії', 'Прокладки и уплотнения трансмиссии', 'Transmission seals and gaskets'),
    ('transmission-drivetrain', 'transfer-case-parts', 80,
      'Деталі роздавальної коробки', 'Детали раздаточной коробки', 'Transfer case parts'),
    ('transmission-drivetrain', 'drivetrain-cv-boots', 90,
      'Пильовики ШРКШ і півосей', 'Пыльники ШРУС и полуосей', 'CV joint and axle boots'),
    ('transmission-drivetrain', 'drivetrain-propeller-shafts', 100,
      'Карданні вали', 'Карданные валы', 'Propeller shafts'),
    ('transmission-drivetrain', 'drivetrain-couplings-dampers', 110,
      'Муфти та демпфери кардана', 'Муфты и демпферы кардана', 'Driveshaft couplings and dampers'),

    ('fuel-system', 'fuel-injectors', 10,
      'Паливні форсунки', 'Топливные форсунки', 'Fuel injectors'),
    ('fuel-system', 'fuel-pumps', 20,
      'Паливні насоси', 'Топливные насосы', 'Fuel pumps'),
    ('fuel-system', 'fuel-lines-hoses', 30,
      'Паливні трубки та шланги', 'Топливные трубки и шланги', 'Fuel lines and hoses'),
    ('fuel-system', 'fuel-rails', 40,
      'Паливні рампи', 'Топливные рампы', 'Fuel rails'),
    ('fuel-system', 'fuel-pressure-valves', 50,
      'Клапани та регулятори паливної системи', 'Клапаны и регуляторы топливной системы', 'Fuel system valves and regulators'),
    ('fuel-system', 'fuel-tanks-modules', 60,
      'Паливні баки та модулі', 'Топливные баки и модули', 'Fuel tanks and modules'),
    ('fuel-system', 'fuel-vapor-canisters', 70,
      'Система уловлювання парів палива', 'Система улавливания паров топлива', 'Fuel vapor and EVAP system'),

    ('cooling', 'cooling-water-pumps', 10,
      'Водяні насоси', 'Водяные насосы', 'Water pumps'),
    ('cooling', 'cooling-thermostats', 20,
      'Термостати системи охолодження', 'Термостаты системы охлаждения', 'Cooling system thermostats'),
    ('cooling', 'cooling-radiators', 30,
      'Радіатори охолодження', 'Радиаторы охлаждения', 'Cooling radiators'),
    ('cooling', 'cooling-hoses-pipes', 40,
      'Патрубки та трубки охолодження', 'Патрубки и трубки охлаждения', 'Cooling hoses and pipes'),
    ('cooling', 'cooling-expansion-tanks', 50,
      'Розширювальні бачки', 'Расширительные бачки', 'Expansion tanks'),
    ('cooling', 'cooling-control-valves', 60,
      'Клапани системи охолодження', 'Клапаны системы охлаждения', 'Cooling system valves'),
    ('cooling', 'cooling-radiator-air-guides-mounts', 70,
      'Повітроводи та кріплення радіатора', 'Воздуховоды и крепления радиатора', 'Radiator air guides and mounts'),

    ('climate', 'climate-air-ducts-vents', 10,
      'Повітроводи та дефлектори', 'Воздуховоды и дефлекторы', 'HVAC air ducts and vents'),
    ('climate', 'climate-condensers', 20,
      'Конденсори кондиціонера', 'Конденсоры кондиционера', 'A/C condensers'),
    ('climate', 'climate-hoses-pipes', 30,
      'Трубки та шланги кліматичної системи', 'Трубки и шланги климатической системы', 'HVAC hoses and pipes'),
    ('climate', 'climate-control-valves', 40,
      'Клапани кліматичної системи', 'Клапаны климатической системы', 'HVAC control valves'),
    ('climate', 'climate-sensors', 50,
      'Датчики кліматичної системи', 'Датчики климатической системы', 'HVAC sensors'),
    ('climate', 'climate-blower-motors', 60,
      'Вентилятори обігрівача', 'Вентиляторы отопителя', 'HVAC blower motors'),
    ('climate', 'climate-receiver-driers', 70,
      'Осушувачі кондиціонера', 'Осушители кондиционера', 'A/C receiver driers')
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
  FROM leaf
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
FROM leaf source
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

DO $$
DECLARE
  expected_leaf_count CONSTANT INTEGER := 32;
  actual_leaf_count INTEGER;
  translation_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO actual_leaf_count
  FROM customer_categories category
  JOIN customer_categories parent ON parent.id = category.parent_id
  WHERE category.slug = ANY(ARRAY[
    'transmission-clutch-components', 'transmission-selector-linkage',
    'transmission-oil-filters', 'transmission-oil-pans',
    'transmission-fluid-lines', 'transmission-valve-bodies',
    'transmission-seals-gaskets', 'transfer-case-parts',
    'drivetrain-cv-boots', 'drivetrain-propeller-shafts',
    'drivetrain-couplings-dampers', 'fuel-injectors', 'fuel-pumps',
    'fuel-lines-hoses', 'fuel-rails', 'fuel-pressure-valves',
    'fuel-tanks-modules', 'fuel-vapor-canisters', 'cooling-water-pumps',
    'cooling-thermostats', 'cooling-radiators', 'cooling-hoses-pipes',
    'cooling-expansion-tanks', 'cooling-control-valves',
    'cooling-radiator-air-guides-mounts', 'climate-air-ducts-vents',
    'climate-condensers', 'climate-hoses-pipes', 'climate-control-valves',
    'climate-sensors', 'climate-blower-motors', 'climate-receiver-driers'
  ]::TEXT[])
    AND category.status = 'ACTIVE'
    AND category.is_active = TRUE
    AND category.is_navigation_visible = FALSE
    AND parent.slug = ANY(ARRAY[
      'transmission-drivetrain', 'fuel-system', 'cooling', 'climate'
    ]::TEXT[]);

  SELECT COUNT(*)::INTEGER
  INTO translation_count
  FROM customer_category_translations translation
  JOIN customer_categories category ON category.id = translation.category_id
  WHERE category.slug = ANY(ARRAY[
    'transmission-clutch-components', 'transmission-selector-linkage',
    'transmission-oil-filters', 'transmission-oil-pans',
    'transmission-fluid-lines', 'transmission-valve-bodies',
    'transmission-seals-gaskets', 'transfer-case-parts',
    'drivetrain-cv-boots', 'drivetrain-propeller-shafts',
    'drivetrain-couplings-dampers', 'fuel-injectors', 'fuel-pumps',
    'fuel-lines-hoses', 'fuel-rails', 'fuel-pressure-valves',
    'fuel-tanks-modules', 'fuel-vapor-canisters', 'cooling-water-pumps',
    'cooling-thermostats', 'cooling-radiators', 'cooling-hoses-pipes',
    'cooling-expansion-tanks', 'cooling-control-valves',
    'cooling-radiator-air-guides-mounts', 'climate-air-ducts-vents',
    'climate-condensers', 'climate-hoses-pipes', 'climate-control-valves',
    'climate-sensors', 'climate-blower-motors', 'climate-receiver-driers'
  ]::TEXT[])
    AND translation.language_code IN ('uk', 'ru', 'en');

  IF actual_leaf_count <> expected_leaf_count THEN
    RAISE EXCEPTION 'Expected % PHASE 2E leaves, found %',
      expected_leaf_count, actual_leaf_count;
  END IF;
  IF translation_count <> expected_leaf_count * 3 THEN
    RAISE EXCEPTION 'Expected % PHASE 2E translations, found %',
      expected_leaf_count * 3, translation_count;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('093_add_customer_taxonomy_phase2e_categories')
ON CONFLICT(version) DO NOTHING;

COMMIT;
