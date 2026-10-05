BEGIN;

-- PHASE 2G.1 adds only reviewed Body/Glass and Interior/Safety leaves.
-- All leaves remain hidden until a later storefront phase enables them.
WITH leaf(parent_slug, slug, sort_order, name_uk, name_ru, name_en) AS (
  VALUES
    ('body-glass', 'body-bumpers', 10, 'Бампери', 'Бамперы', 'Bumpers'),
    ('body-glass', 'body-mouldings-trims', 20, 'Зовнішні молдинги та накладки', 'Наружные молдинги и накладки', 'Exterior mouldings & trims'),
    ('body-glass', 'body-grilles', 30, 'Решітки', 'Решётки', 'Grilles'),
    ('body-glass', 'body-locks-latches', 40, 'Замки та засувки', 'Замки и защёлки', 'Locks & latches'),
    ('body-glass', 'body-door-handles', 50, 'Ручки дверей', 'Ручки дверей', 'Door handles'),
    ('body-glass', 'body-fenders', 60, 'Крила', 'Крылья', 'Fenders'),
    ('body-glass', 'body-hoods', 70, 'Капоти', 'Капоты', 'Hoods'),
    ('body-glass', 'body-bumper-mounts', 80, 'Кріплення бамперів', 'Крепления бамперов', 'Bumper mounts'),
    ('body-glass', 'body-mirror-parts', 90, 'Деталі дзеркал', 'Детали зеркал', 'Mirror parts'),
    ('body-glass', 'body-side-windows', 100, 'Бокове скло', 'Боковые стёкла', 'Side glass'),
    ('body-glass', 'body-emblems', 110, 'Емблеми та шильдики', 'Эмблемы и шильдики', 'Emblems & badges'),
    ('body-glass', 'body-tailgates-trunk-lids', 120, 'Кришки та двері багажника', 'Крышки багажника и двери багажника', 'Trunk lids & tailgates'),
    ('body-glass', 'body-wheel-arch-liners', 130, 'Підкрилки та бризковики', 'Подкрылки и брызговики', 'Wheel-arch liners & splash guards'),
    ('body-glass', 'body-exterior-mirrors', 140, 'Зовнішні дзеркала', 'Наружные зеркала', 'Exterior mirrors'),
    ('body-glass', 'body-door-hinges', 150, 'Петлі та обмежувачі дверей', 'Петли и ограничители дверей', 'Door hinges & checks'),
    ('body-glass', 'body-roof-parts', 160, 'Деталі даху', 'Детали крыши', 'Roof parts'),
    ('body-glass', 'body-exterior-panels', 170, 'Зовнішні кузовні панелі', 'Наружные кузовные панели', 'Exterior body panels'),
    ('body-glass', 'body-underbody-shields', 180, 'Захист днища', 'Защита днища', 'Underbody shields'),
    ('interior-safety', 'interior-seats', 10, 'Сидіння', 'Сиденья', 'Seats'),
    ('interior-safety', 'safety-airbags', 20, 'Подушки безпеки', 'Подушки безопасности', 'Airbags'),
    ('interior-safety', 'interior-trim-panels', 30, 'Оздоблення та панелі салону', 'Отделка и панели салона', 'Interior trim & panels'),
    ('interior-safety', 'interior-pedals', 40, 'Педалі', 'Педали', 'Pedals'),
    ('interior-safety', 'interior-seat-mechanisms', 50, 'Механізми та напрямні сидінь', 'Механизмы и направляющие сидений', 'Seat mechanisms & rails'),
    ('interior-safety', 'safety-restraint-components', 60, 'Компоненти утримувальних систем', 'Компоненты удерживающих систем', 'Restraint-system components')
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
  expected_leaf_count CONSTANT INTEGER := 24;
  actual_leaf_count INTEGER;
  translation_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO actual_leaf_count
  FROM customer_categories category
  JOIN customer_categories parent ON parent.id = category.parent_id
  WHERE category.slug = ANY(ARRAY[
      'body-bumpers',
      'body-mouldings-trims',
      'body-grilles',
      'body-locks-latches',
      'body-door-handles',
      'body-fenders',
      'body-hoods',
      'body-bumper-mounts',
      'body-mirror-parts',
      'body-side-windows',
      'body-emblems',
      'body-tailgates-trunk-lids',
      'body-wheel-arch-liners',
      'body-exterior-mirrors',
      'body-door-hinges',
      'body-roof-parts',
      'body-exterior-panels',
      'body-underbody-shields',
      'interior-seats',
      'safety-airbags',
      'interior-trim-panels',
      'interior-pedals',
      'interior-seat-mechanisms',
      'safety-restraint-components'
    ]::TEXT[])
    AND category.status = 'ACTIVE'
    AND category.is_active = TRUE
    AND category.is_navigation_visible = FALSE
    AND parent.slug IN ('body-glass', 'interior-safety');

  SELECT COUNT(*)::INTEGER INTO translation_count
  FROM customer_category_translations translation
  JOIN customer_categories category ON category.id = translation.category_id
  WHERE category.slug = ANY(ARRAY[
      'body-bumpers',
      'body-mouldings-trims',
      'body-grilles',
      'body-locks-latches',
      'body-door-handles',
      'body-fenders',
      'body-hoods',
      'body-bumper-mounts',
      'body-mirror-parts',
      'body-side-windows',
      'body-emblems',
      'body-tailgates-trunk-lids',
      'body-wheel-arch-liners',
      'body-exterior-mirrors',
      'body-door-hinges',
      'body-roof-parts',
      'body-exterior-panels',
      'body-underbody-shields',
      'interior-seats',
      'safety-airbags',
      'interior-trim-panels',
      'interior-pedals',
      'interior-seat-mechanisms',
      'safety-restraint-components'
    ]::TEXT[])
    AND translation.language_code IN ('uk','ru','en');

  IF actual_leaf_count <> expected_leaf_count THEN
    RAISE EXCEPTION 'Expected % PHASE 2G.1 leaves, found %', expected_leaf_count, actual_leaf_count;
  END IF;
  IF translation_count <> expected_leaf_count * 3 THEN
    RAISE EXCEPTION 'Expected % PHASE 2G.1 translations, found %', expected_leaf_count * 3, translation_count;
  END IF;
END;
$$;

INSERT INTO schema_migrations(version) VALUES ('097_add_customer_taxonomy_phase2g1_categories')
ON CONFLICT(version) DO NOTHING;

COMMIT;
