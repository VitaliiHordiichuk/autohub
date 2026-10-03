BEGIN;

-- PHASE 2D adds customer-facing leaves only. The technical Mercedes/EPC
-- taxonomy remains unchanged and the new leaves stay hidden from navigation.
WITH batch2_leaf(
  parent_slug,
  slug,
  sort_order,
  name_uk,
  name_ru,
  name_en
) AS (
  VALUES
    ('steering', 'steering-racks', 10, 'Рульові рейки', 'Рулевые рейки', 'Steering racks'),
    ('steering', 'steering-tie-rods', 20, 'Рульові тяги', 'Рулевые тяги', 'Steering tie rods'),
    ('steering', 'steering-tie-rod-ends', 30, 'Наконечники рульових тяг', 'Наконечники рулевых тяг', 'Steering tie rod ends'),
    ('steering', 'steering-pumps', 40, 'Насоси рульового керування', 'Насосы рулевого управления', 'Steering pumps'),
    ('steering', 'steering-shafts', 50, 'Рульові вали', 'Рулевые валы', 'Steering shafts'),
    ('steering', 'steering-reservoirs', 60, 'Бачки рульового керування', 'Бачки рулевого управления', 'Steering reservoirs'),
    ('steering', 'steering-hoses-pipes', 70, 'Шланги та трубки рульового керування', 'Шланги и трубки рулевого управления', 'Steering hoses and pipes'),
    ('steering', 'steering-other', 80, 'Інші деталі рульового керування', 'Другие детали рулевого управления', 'Other steering parts'),
    ('exhaust', 'exhaust-catalysts', 10, 'Каталізатори', 'Катализаторы', 'Catalytic converters'),
    ('exhaust', 'exhaust-mufflers', 20, 'Глушники', 'Глушители', 'Mufflers'),
    ('exhaust', 'exhaust-pipes', 30, 'Вихлопні труби', 'Выхлопные трубы', 'Exhaust pipes'),
    ('exhaust', 'exhaust-sensors', 40, 'Датчики вихлопної системи', 'Датчики выхлопной системы', 'Exhaust sensors'),
    ('exhaust', 'exhaust-mounts', 50, 'Кріплення вихлопної системи', 'Крепления выхлопной системы', 'Exhaust mounts'),
    ('exhaust', 'exhaust-other', 60, 'Інші деталі вихлопної системи', 'Другие детали выхлопной системы', 'Other exhaust parts'),
    ('wheels', 'wheels-rims', 10, 'Колісні диски', 'Колёсные диски', 'Wheel rims'),
    ('wheels', 'wheels-caps', 20, 'Ковпаки та заглушки коліс', 'Колпаки и заглушки колёс', 'Wheel caps and covers'),
    ('wheels', 'wheels-bolts-nuts', 30, 'Колісні болти та гайки', 'Колёсные болты и гайки', 'Wheel bolts and nuts'),
    ('wheels', 'wheels-pressure-sensors', 40, 'Датчики тиску в шинах', 'Датчики давления в шинах', 'Tyre pressure sensors'),
    ('wheels', 'wheels-other', 50, 'Інші деталі коліс', 'Другие детали колёс', 'Other wheel parts')
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
  FROM batch2_leaf leaf
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
FROM batch2_leaf source
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
  expected_count CONSTANT INTEGER := 19;
  actual_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO actual_count
  FROM customer_categories category
  JOIN customer_categories parent ON parent.id = category.parent_id
  WHERE category.slug = ANY(ARRAY[
    'steering-racks', 'steering-tie-rods', 'steering-tie-rod-ends',
    'steering-pumps', 'steering-shafts', 'steering-reservoirs',
    'steering-hoses-pipes', 'steering-other', 'exhaust-catalysts',
    'exhaust-mufflers', 'exhaust-pipes', 'exhaust-sensors',
    'exhaust-mounts', 'exhaust-other', 'wheels-rims', 'wheels-caps',
    'wheels-bolts-nuts', 'wheels-pressure-sensors', 'wheels-other'
  ]::TEXT[])
    AND parent.slug IN ('steering', 'exhaust', 'wheels')
    AND category.status = 'ACTIVE'
    AND category.is_active = TRUE
    AND category.is_navigation_visible = FALSE;

  IF actual_count <> expected_count THEN
    RAISE EXCEPTION
      'Customer taxonomy batch 2 expected % active hidden leaves but found %',
      expected_count,
      actual_count;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('089_add_customer_taxonomy_batch2_categories')
ON CONFLICT(version) DO NOTHING;

COMMIT;
