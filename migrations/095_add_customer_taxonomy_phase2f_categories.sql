BEGIN;

-- PHASE 2F adds reviewed engine and suspension customer-facing leaves only.
-- They remain hidden until a later storefront phase explicitly enables them.
WITH leaf(
  parent_slug, slug, sort_order, name_uk, name_ru, name_en
) AS (
  VALUES
    ('engine', 'engine-gaskets-seals', 10,
      'Прокладки та ущільнення двигуна', 'Прокладки и уплотнения двигателя', 'Engine gaskets and seals'),
    ('engine', 'engine-mounts', 20,
      'Опори та подушки двигуна', 'Опоры и подушки двигателя', 'Engine mounts'),
    ('engine', 'engine-belt-tensioners', 30,
      'Натягувачі приводного ременя', 'Натяжители приводного ремня', 'Drive belt tensioners'),
    ('engine', 'engine-covers-crankcase', 40,
      'Кришки та картер двигуна', 'Крышки и картер двигателя', 'Engine covers and crankcase'),
    ('engine', 'engine-valvetrain-components', 50,
      'Клапанний механізм', 'Клапанный механизм', 'Valvetrain components'),
    ('engine', 'engine-timing-components', 60,
      'Компоненти ГРМ', 'Компоненты ГРМ', 'Timing components'),
    ('engine', 'engine-oil-system-components', 70,
      'Компоненти оливної системи', 'Компоненты масляной системы', 'Engine oil system components'),
    ('engine', 'engine-intake-manifolds-throttle', 80,
      'Впускні колектори та дроселі', 'Впускные коллекторы и дроссели', 'Intake manifolds and throttle bodies'),
    ('engine', 'engine-intake-air-ducts', 90,
      'Повітроводи впуску', 'Воздуховоды впуска', 'Intake air ducts'),
    ('engine', 'engine-block-crankshaft-pistons', 100,
      'Блок, колінвал і поршні', 'Блок, коленвал и поршни', 'Engine block, crankshaft and pistons'),
    ('engine', 'engine-crankcase-ventilation', 110,
      'Вентиляція картера', 'Вентиляция картера', 'Crankcase ventilation'),
    ('engine', 'engine-belt-rollers-idlers', 120,
      'Ролики та обвідні ролики', 'Ролики и обводные ролики', 'Belt rollers and idlers'),
    ('engine', 'engine-cylinder-head-components', 130,
      'Головка блока та компоненти', 'Головка блока и компоненты', 'Cylinder head components'),
    ('engine', 'engine-turbo-charge-air', 140,
      'Турбіна та наддув', 'Турбина и наддув', 'Turbo and charge-air components'),
    ('engine', 'engine-vacuum-system', 150,
      'Вакуумна система двигуна', 'Вакуумная система двигателя', 'Engine vacuum system'),
    ('engine', 'engine-oil-lines-coolers', 160,
      'Трубки та радіатори оливи', 'Трубки и радиаторы масла', 'Engine oil lines and coolers'),
    ('engine', 'engine-oil-pumps', 170,
      'Оливні насоси', 'Масляные насосы', 'Engine oil pumps'),
    ('engine', 'engine-air-filter-housings', 180,
      'Корпуси повітряного фільтра', 'Корпуса воздушного фильтра', 'Engine air-filter housings'),
    ('engine', 'engine-belt-pulleys', 190,
      'Приводні шківи', 'Приводные шкивы', 'Drive pulleys'),
    ('engine', 'engine-sensors', 200,
      'Датчики двигуна', 'Датчики двигателя', 'Engine sensors'),
    ('suspension', 'suspension-shock-absorbers', 10,
      'Амортизатори та стійки', 'Амортизаторы и стойки', 'Shock absorbers and struts'),
    ('suspension', 'suspension-control-arms', 20,
      'Важелі підвіски', 'Рычаги подвески', 'Suspension control arms'),
    ('suspension', 'suspension-stabilizer-links', 30,
      'Стійки та тяги стабілізатора', 'Стойки и тяги стабилизатора', 'Stabilizer links'),
    ('suspension', 'suspension-bushings-mounts', 40,
      'Сайлентблоки та опори підвіски', 'Сайлентблоки и опоры подвески', 'Suspension bushings and mounts'),
    ('suspension', 'suspension-springs', 50,
      'Пружини підвіски', 'Пружины подвески', 'Suspension springs'),
    ('suspension', 'suspension-strut-mounts-protection', 60,
      'Опори, пильовики та відбійники', 'Опоры, пыльники и отбойники', 'Strut mounts, boots and bump stops'),
    ('suspension', 'suspension-links-rods', 70,
      'Тяги підвіски', 'Тяги подвески', 'Suspension links and rods'),
    ('suspension', 'suspension-air-components', 80,
      'Пневмопідвіска', 'Пневмоподвеска', 'Air suspension components'),
    ('suspension', 'suspension-wheel-bearings-hubs', 90,
      'Маточини та підшипники', 'Ступицы и подшипники', 'Wheel hubs and bearings'),
    ('suspension', 'suspension-ball-joints', 100,
      'Кульові опори', 'Шаровые опоры', 'Ball joints'),
    ('suspension', 'suspension-stabilizer-bushings', 110,
      'Втулки стабілізатора', 'Втулки стабилизатора', 'Stabilizer bushings'),
    ('suspension', 'suspension-knuckles-carriers', 120,
      'Поворотні кулаки', 'Поворотные кулаки', 'Steering knuckles and wheel carriers'),
    ('suspension', 'suspension-hydraulic-components', 130,
      'Гідравліка підвіски', 'Гидравлика подвески', 'Suspension hydraulic components'),
    ('suspension', 'suspension-level-control', 140,
      'Датчики та тяги рівня', 'Датчики и тяги уровня', 'Suspension level-control parts'),
    ('suspension', 'suspension-subframes', 150,
      'Підрамники та кріплення', 'Подрамники и крепления', 'Suspension subframes and mounts')
), upserted AS (
  INSERT INTO customer_categories(
    slug, parent_id, status, is_active, is_navigation_visible, sort_order
  )
  SELECT
    leaf.slug, parent.id, 'ACTIVE', TRUE, FALSE, leaf.sort_order
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
  expected_leaf_count CONSTANT INTEGER := 35;
  actual_leaf_count INTEGER;
  translation_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO actual_leaf_count
  FROM customer_categories category
  JOIN customer_categories parent ON parent.id = category.parent_id
  WHERE category.slug = ANY(ARRAY[
      'engine-gaskets-seals',
      'engine-mounts',
      'engine-belt-tensioners',
      'engine-covers-crankcase',
      'engine-valvetrain-components',
      'engine-timing-components',
      'engine-oil-system-components',
      'engine-intake-manifolds-throttle',
      'engine-intake-air-ducts',
      'engine-block-crankshaft-pistons',
      'engine-crankcase-ventilation',
      'engine-belt-rollers-idlers',
      'engine-cylinder-head-components',
      'engine-turbo-charge-air',
      'engine-vacuum-system',
      'engine-oil-lines-coolers',
      'engine-oil-pumps',
      'engine-air-filter-housings',
      'engine-belt-pulleys',
      'engine-sensors',
      'suspension-shock-absorbers',
      'suspension-control-arms',
      'suspension-stabilizer-links',
      'suspension-bushings-mounts',
      'suspension-springs',
      'suspension-strut-mounts-protection',
      'suspension-links-rods',
      'suspension-air-components',
      'suspension-wheel-bearings-hubs',
      'suspension-ball-joints',
      'suspension-stabilizer-bushings',
      'suspension-knuckles-carriers',
      'suspension-hydraulic-components',
      'suspension-level-control',
      'suspension-subframes'
    ]::TEXT[])
    AND category.status = 'ACTIVE'
    AND category.is_active = TRUE
    AND category.is_navigation_visible = FALSE
    AND parent.slug IN ('engine', 'suspension');

  SELECT COUNT(*)::INTEGER INTO translation_count
  FROM customer_category_translations translation
  JOIN customer_categories category ON category.id = translation.category_id
  WHERE category.slug = ANY(ARRAY[
      'engine-gaskets-seals',
      'engine-mounts',
      'engine-belt-tensioners',
      'engine-covers-crankcase',
      'engine-valvetrain-components',
      'engine-timing-components',
      'engine-oil-system-components',
      'engine-intake-manifolds-throttle',
      'engine-intake-air-ducts',
      'engine-block-crankshaft-pistons',
      'engine-crankcase-ventilation',
      'engine-belt-rollers-idlers',
      'engine-cylinder-head-components',
      'engine-turbo-charge-air',
      'engine-vacuum-system',
      'engine-oil-lines-coolers',
      'engine-oil-pumps',
      'engine-air-filter-housings',
      'engine-belt-pulleys',
      'engine-sensors',
      'suspension-shock-absorbers',
      'suspension-control-arms',
      'suspension-stabilizer-links',
      'suspension-bushings-mounts',
      'suspension-springs',
      'suspension-strut-mounts-protection',
      'suspension-links-rods',
      'suspension-air-components',
      'suspension-wheel-bearings-hubs',
      'suspension-ball-joints',
      'suspension-stabilizer-bushings',
      'suspension-knuckles-carriers',
      'suspension-hydraulic-components',
      'suspension-level-control',
      'suspension-subframes'
    ]::TEXT[])
    AND translation.language_code IN ('uk', 'ru', 'en');

  IF actual_leaf_count <> expected_leaf_count THEN
    RAISE EXCEPTION 'Expected % PHASE 2F leaves, found %',
      expected_leaf_count, actual_leaf_count;
  END IF;
  IF translation_count <> expected_leaf_count * 3 THEN
    RAISE EXCEPTION 'Expected % PHASE 2F translations, found %',
      expected_leaf_count * 3, translation_count;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('095_add_customer_taxonomy_phase2f_categories')
ON CONFLICT(version) DO NOTHING;

COMMIT;
