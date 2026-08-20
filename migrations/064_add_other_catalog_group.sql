BEGIN;

INSERT INTO categories(
  parent_id,
  name,
  name_uk,
  name_ru,
  name_en,
  slug,
  sort_order,
  is_active
)
VALUES(
  NULL,
  'Остальное',
  'Інше',
  'Остальное',
  'Other',
  'other',
  10000,
  TRUE
)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION classify_product_category(target_product_id INTEGER)
RETURNS VOID AS $$
DECLARE
  selected_category INTEGER;
  selected_confidence NUMERIC(5,2) := 90;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source = 'MANUAL'
  ) THEN
    DELETE FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source = 'AUTO_RULE';
    RETURN;
  END IF;

  SELECT rule.category_id INTO selected_category
  FROM products p
  JOIN category_classification_rules rule
    ON rule.is_active
    AND p.name ~* rule.pattern
  JOIN categories category
    ON category.id = rule.category_id
    AND category.is_active = TRUE
  WHERE p.id = target_product_id
  ORDER BY rule.priority, rule.id
  LIMIT 1;

  IF selected_category IS NULL THEN
    SELECT id INTO selected_category
    FROM categories
    WHERE slug = 'other'
      AND is_active = TRUE
    LIMIT 1;

    selected_confidence := 0;
  END IF;

  DELETE FROM product_categories
  WHERE product_id = target_product_id
    AND assignment_source = 'AUTO_RULE';

  IF selected_category IS NOT NULL THEN
    INSERT INTO product_categories(
      product_id,
      category_id,
      assignment_source,
      confidence
    )
    VALUES(
      target_product_id,
      selected_category,
      'AUTO_RULE',
      selected_confidence
    )
    ON CONFLICT(product_id, category_id)
    DO UPDATE SET
      assignment_source = 'AUTO_RULE',
      confidence = EXCLUDED.confidence;
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT classify_product_category(id)
FROM products;

SELECT apply_catalog_assignment_overrides(id)
FROM products;

GRANT EXECUTE ON FUNCTION classify_product_category(INTEGER) TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('064_add_other_catalog_group')
ON CONFLICT(version) DO NOTHING;

COMMIT;
