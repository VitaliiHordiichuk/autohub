BEGIN;

INSERT INTO categories(
  parent_id, name, name_uk, name_ru, name_en, slug, sort_order, is_active
)
SELECT
  NULL,
  'Аксессуары',
  'Аксесуари',
  'Аксессуары',
  'Accessories',
  'accessories',
  100,
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM categories WHERE slug = 'accessories'
);

CREATE OR REPLACE FUNCTION apply_catalog_assignment_overrides(target_product_id INTEGER)
RETURNS VOID AS $$
DECLARE
  target_product products%ROWTYPE;
  accessories_category_id INTEGER;
  is_mercedes BOOLEAN;
BEGIN
  SELECT * INTO target_product
  FROM products
  WHERE id = target_product_id;

  IF target_product.id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source = 'MANUAL'
  ) THEN
    DELETE FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source = 'AUTO_RULE';
    RETURN;
  END IF;

  SELECT id INTO accessories_category_id
  FROM categories
  WHERE slug = 'accessories' AND is_active = TRUE
  LIMIT 1;

  SELECT (
    EXISTS (
      SELECT 1 FROM brands b
      WHERE b.id = target_product.brand_id
        AND LOWER(b.name) LIKE '%mercedes%'
    )
    OR EXISTS (
      SELECT 1 FROM part_manufacturers pm
      WHERE pm.id = target_product.manufacturer_id
        AND LOWER(pm.name) LIKE '%mercedes%'
    )
  ) INTO is_mercedes;

  IF accessories_category_id IS NOT NULL
    AND is_mercedes
    AND UPPER(COALESCE(target_product.article_normalized, target_product.article, '')) LIKE 'B%'
  THEN
    DELETE FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source = 'AUTO_RULE';

    INSERT INTO product_categories(product_id, category_id, assignment_source, confidence)
    VALUES(target_product_id, accessories_category_id, 'AUTO_RULE', 100)
    ON CONFLICT(product_id, category_id)
    DO UPDATE SET assignment_source = 'AUTO_RULE', confidence = 100;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION apply_catalog_assignment_overrides_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM apply_catalog_assignment_overrides(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS zz_products_catalog_assignment_overrides ON products;
CREATE TRIGGER zz_products_catalog_assignment_overrides
AFTER INSERT OR UPDATE OF name, article, article_normalized, brand_id, manufacturer_id
ON products
FOR EACH ROW
EXECUTE FUNCTION apply_catalog_assignment_overrides_trigger();

SELECT apply_catalog_assignment_overrides(id)
FROM products;

GRANT EXECUTE ON FUNCTION apply_catalog_assignment_overrides(INTEGER) TO autohub_app;
GRANT EXECUTE ON FUNCTION apply_catalog_assignment_overrides_trigger() TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('058_add_accessories_and_category_management')
ON CONFLICT(version) DO NOTHING;

COMMIT;
