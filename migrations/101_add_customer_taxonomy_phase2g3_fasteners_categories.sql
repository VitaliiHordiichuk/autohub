BEGIN;

-- PHASE 2G.3 adds only reviewed Fasteners / Seals / Standard Parts leaves.
-- All leaves remain hidden until a later storefront phase enables them.
WITH leaf(parent_slug, slug, sort_order, name_uk, name_ru, name_en) AS (
  VALUES
    ('fasteners-seals-standard-parts', 'fasteners-bolts', 10, 'Болти', 'Болты', 'Bolts'),
    ('fasteners-seals-standard-parts', 'fasteners-seals-gaskets', 20, 'Ущільнення та прокладки', 'Уплотнения и прокладки', 'Seals & gaskets'),
    ('fasteners-seals-standard-parts', 'fasteners-screws', 30, 'Гвинти та саморізи', 'Винты и саморезы', 'Screws'),
    ('fasteners-seals-standard-parts', 'fasteners-nuts', 40, 'Гайки', 'Гайки', 'Nuts'),
    ('fasteners-seals-standard-parts', 'fasteners-clamps', 50, 'Скоби та хомути', 'Скобы и хомуты', 'Clamps'),
    ('fasteners-seals-standard-parts', 'fasteners-clips-rivets', 60, 'Кліпси та заклепки', 'Клипсы и заклёпки', 'Clips & rivets'),
    ('fasteners-seals-standard-parts', 'fasteners-plugs-caps', 70, 'Заглушки та пробки', 'Заглушки и пробки', 'Plugs & caps'),
    ('fasteners-seals-standard-parts', 'fasteners-washers', 80, 'Шайби', 'Шайбы', 'Washers'),
    ('fasteners-seals-standard-parts', 'fasteners-grommets', 90, 'Втулки та прохідні ущільнення', 'Втулки и проходные уплотнения', 'Grommets'),
    ('fasteners-seals-standard-parts', 'fasteners-sealing-rings', 100, 'Ущільнювальні кільця', 'Уплотнительные кольца', 'Sealing rings'),
    ('fasteners-seals-standard-parts', 'fasteners-pins-circlips', 110, 'Штифти та стопорні кільця', 'Штифты и стопорные кольца', 'Pins & circlips'),
    ('fasteners-seals-standard-parts', 'fasteners-studs', 120, 'Шпильки', 'Шпильки', 'Studs')
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
  expected_leaf_count CONSTANT INTEGER := 12;
  actual_leaf_count INTEGER;
  translation_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO actual_leaf_count
  FROM customer_categories category
  JOIN customer_categories parent ON parent.id = category.parent_id
  WHERE category.slug = ANY(ARRAY[
      'fasteners-bolts',
      'fasteners-seals-gaskets',
      'fasteners-screws',
      'fasteners-nuts',
      'fasteners-clamps',
      'fasteners-clips-rivets',
      'fasteners-plugs-caps',
      'fasteners-washers',
      'fasteners-grommets',
      'fasteners-sealing-rings',
      'fasteners-pins-circlips',
      'fasteners-studs'
    ]::TEXT[])
    AND category.status = 'ACTIVE'
    AND category.is_active = TRUE
    AND category.is_navigation_visible = FALSE
    AND parent.slug = 'fasteners-seals-standard-parts';

  SELECT COUNT(*)::INTEGER INTO translation_count
  FROM customer_category_translations translation
  JOIN customer_categories category ON category.id = translation.category_id
  WHERE category.slug = ANY(ARRAY[
      'fasteners-bolts',
      'fasteners-seals-gaskets',
      'fasteners-screws',
      'fasteners-nuts',
      'fasteners-clamps',
      'fasteners-clips-rivets',
      'fasteners-plugs-caps',
      'fasteners-washers',
      'fasteners-grommets',
      'fasteners-sealing-rings',
      'fasteners-pins-circlips',
      'fasteners-studs'
    ]::TEXT[])
    AND translation.language_code IN ('uk','ru','en');

  IF actual_leaf_count <> expected_leaf_count THEN
    RAISE EXCEPTION 'Expected % PHASE 2G.3 leaves, found %', expected_leaf_count, actual_leaf_count;
  END IF;
  IF translation_count <> expected_leaf_count * 3 THEN
    RAISE EXCEPTION 'Expected % PHASE 2G.3 translations, found %', expected_leaf_count * 3, translation_count;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version)
VALUES ('101_add_customer_taxonomy_phase2g3_fasteners_categories')
ON CONFLICT(version) DO NOTHING;

COMMIT;
