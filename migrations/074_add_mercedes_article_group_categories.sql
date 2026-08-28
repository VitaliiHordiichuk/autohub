BEGIN;

-- The public catalogue stays compact: customer-friendly root sections contain
-- exact Mercedes-Benz two-digit part-number groups.
WITH roots(slug, name, name_uk, name_ru, name_en, sort_order) AS (
  VALUES
    ('transmission', 'Коробка передач', 'Коробка передач', 'Коробка передач', 'Transmission', 35),
    ('drivetrain', 'Трансмиссия', 'Трансмісія', 'Трансмиссия', 'Drivetrain', 65),
    ('wheels', 'Колёса', 'Колеса', 'Колёса', 'Wheels', 68),
    ('climate', 'Климатическая система', 'Кліматична система', 'Климатическая система', 'Climate system', 75),
    ('exhaust', 'Выхлопная система', 'Вихлопна система', 'Выхлопная система', 'Exhaust system', 78),
    ('interior', 'Салон и безопасность', 'Салон і безпека', 'Салон и безопасность', 'Interior and safety', 95),
    ('controls', 'Педали и управление', 'Педалі та керування', 'Педали и управление', 'Pedals and controls', 97),
    ('fasteners', 'Крепёж', 'Кріплення', 'Крепёж', 'Fasteners', 98)
)
INSERT INTO categories(
  parent_id, name, name_uk, name_ru, name_en, slug, sort_order, is_active
)
SELECT NULL, roots.name, roots.name_uk, roots.name_ru, roots.name_en,
       roots.slug, roots.sort_order, TRUE
FROM roots
ON CONFLICT(slug) WHERE slug IS NOT NULL
DO UPDATE SET
  parent_id = NULL,
  name = EXCLUDED.name,
  name_uk = EXCLUDED.name_uk,
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

-- Keep the established main sections and their order stable.
WITH roots(slug, sort_order) AS (
  VALUES
    ('accessories', 0),
    ('engine', 10),
    ('fuel-system', 20),
    ('cooling', 30),
    ('brakes', 40),
    ('suspension', 50),
    ('steering', 60),
    ('electrical', 70),
    ('body', 90),
    ('other', 10000)
)
UPDATE categories category
SET sort_order = roots.sort_order,
    is_active = TRUE
FROM roots
WHERE category.slug = roots.slug;

WITH groups(
  parent_slug, slug, name_uk, name_ru, name_en, sort_order
) AS (
  VALUES
    ('accessories', 'mb-accessories-b', 'Оригінальні аксесуари Mercedes (B)', 'Оригинальные аксессуары Mercedes (B)', 'Original Mercedes accessories (B)', 1),

    ('engine', 'mb-group-01', '01 · Корпус двигуна', '01 · Корпус двигателя', '01 · Engine housing', 1),
    ('engine', 'mb-group-03', '03 · Кривошипно-шатунний механізм', '03 · Кривошипно-шатунный механизм', '03 · Crank assembly', 3),
    ('engine', 'mb-group-05', '05 · ГРМ і клапанний механізм', '05 · ГРМ и клапанный механизм', '05 · Engine timing and valves', 5),
    ('fuel-system', 'mb-group-07', '07 · Упорскування палива', '07 · Впрыск топлива', '07 · Fuel injection', 7),
    ('engine', 'mb-group-09', '09 · Повітряний фільтр і наддув', '09 · Воздушный фильтр и наддув', '09 · Air filter and charging', 9),
    ('engine', 'mb-group-14', '14 · Впуск і випуск двигуна', '14 · Впуск и выпуск двигателя', '14 · Engine intake and exhaust', 14),
    ('electrical', 'mb-group-15', '15 · Електрообладнання двигуна', '15 · Электрооборудование двигателя', '15 · Engine electrical equipment', 15),
    ('engine', 'mb-group-18', '18 · Система змащення двигуна', '18 · Система смазки двигателя', '18 · Engine lubrication', 18),
    ('cooling', 'mb-group-20', '20 · Охолодження двигуна', '20 · Охлаждение двигателя', '20 · Engine cooling', 20),
    ('body', 'mb-group-21', '21 · Знімні кузовні компоненти', '21 · Съёмные кузовные компоненты', '21 · Detachable body components', 21),
    ('engine', 'mb-group-22', '22 · Кронштейни та кожухи двигуна', '22 · Кронштейны и кожухи двигателя', '22 · Engine brackets and covers', 22),
    ('engine', 'mb-group-23', '23 · Навісні агрегати двигуна', '23 · Навесные агрегаты двигателя', '23 · Engine accessory drives', 23),
    ('engine', 'mb-group-24', '24 · Опори двигуна та КПП', '24 · Опоры двигателя и КПП', '24 · Engine and transmission mounts', 24),

    ('transmission', 'mb-group-25', '25 · Зчеплення', '25 · Сцепление', '25 · Clutch', 25),
    ('transmission', 'mb-group-26', '26 · Механічна КПП і перемикання', '26 · Механическая КПП и переключение', '26 · Manual transmission and shifting', 26),
    ('transmission', 'mb-group-27', '27 · Автоматична КПП', '27 · Автоматическая КПП', '27 · Automatic transmission', 27),
    ('transmission', 'mb-group-28', '28 · Роздавальна коробка', '28 · Раздаточная коробка', '28 · Transfer case', 28),
    ('controls', 'mb-group-29', '29 · Педальний вузол', '29 · Педальный узел', '29 · Pedal assembly', 29),
    ('controls', 'mb-group-30', '30 · Керування акселератором', '30 · Управление акселератором', '30 · Accelerator controls', 30),
    ('controls', 'mb-group-31', '31 · Причіпний пристрій та керування', '31 · Прицепное устройство и управление', '31 · Trailer coupling and controls', 31),

    ('suspension', 'mb-group-32', '32 · Пружини, підвіска та гідравліка', '32 · Пружины, подвеска и гидравлика', '32 · Springs, suspension and hydraulics', 32),
    ('suspension', 'mb-group-33', '33 · Передня вісь', '33 · Передняя ось', '33 · Front axle', 33),
    ('suspension', 'mb-group-35', '35 · Задня вісь', '35 · Задняя ось', '35 · Rear axle', 35),
    ('drivetrain', 'mb-group-36', '36 · Півосі та пильовики', '36 · Полуоси и пыльники', '36 · Axle shafts and boots', 36),
    ('transmission', 'mb-group-37', '37 · Деталі та ущільнення КПП', '37 · Детали и уплотнения КПП', '37 · Transmission components and seals', 37),
    ('wheels', 'mb-group-40', '40 · Колеса та шини', '40 · Колёса и шины', '40 · Wheels and tyres', 40),
    ('drivetrain', 'mb-group-41', '41 · Карданний вал', '41 · Карданный вал', '41 · Propeller shaft', 41),
    ('brakes', 'mb-group-42', '42 · Гальмівна система', '42 · Тормозная система', '42 · Brakes', 42),
    ('brakes', 'mb-group-43', '43 · Гідравліка та підсилювач гальм', '43 · Гидравлика и усилитель тормозов', '43 · Brake hydraulics and booster', 43),
    ('electrical', 'mb-group-44', '44 · Проводка та блоки керування', '44 · Проводка и блоки управления', '44 · Wiring and control units', 44),
    ('steering', 'mb-group-46', '46 · Рульове керування', '46 · Рулевое управление', '46 · Steering', 46),
    ('fuel-system', 'mb-group-47', '47 · Паливна система та AdBlue', '47 · Топливная система и AdBlue', '47 · Fuel system and AdBlue', 47),
    ('exhaust', 'mb-group-49', '49 · Вихлоп і очищення газів', '49 · Выхлоп и очистка газов', '49 · Exhaust and emission control', 49),
    ('cooling', 'mb-group-50', '50 · Радіатори та система охолодження', '50 · Радиаторы и система охлаждения', '50 · Radiators and cooling system', 50),
    ('body', 'mb-group-52', '52 · Захист кузова та повітрозабірники', '52 · Защита кузова и воздухозаборники', '52 · Chassis protection and air intake', 52),
    ('electrical', 'mb-group-54', '54 · Електрообладнання та прилади', '54 · Электрооборудование и приборы', '54 · Electrical equipment and instruments', 54),
    ('accessories', 'mb-group-58', '58 · Інструменти та приладдя', '58 · Инструменты и принадлежности', '58 · Tools and accessories', 58),

    ('body', 'mb-group-60', '60 · Каркас кузова', '60 · Каркас кузова', '60 · Body shell', 60),
    ('body', 'mb-group-61', '61 · Підлога та нижня частина кузова', '61 · Пол и нижняя часть кузова', '61 · Substructure', 61),
    ('body', 'mb-group-62', '62 · Передня частина кузова', '62 · Передняя часть кузова', '62 · Front end', 62),
    ('body', 'mb-group-63', '63 · Бічні панелі кузова', '63 · Боковые панели кузова', '63 · Side panels', 63),
    ('body', 'mb-group-64', '64 · Задня частина кузова', '64 · Задняя часть кузова', '64 · Rear body section', 64),
    ('body', 'mb-group-65', '65 · Дах', '65 · Крыша', '65 · Roof', 65),
    ('body', 'mb-group-67', '67 · Автомобільне скло', '67 · Автомобильные стёкла', '67 · Windows', 67),
    ('interior', 'mb-group-68', '68 · Внутрішнє оздоблення та багажник', '68 · Внутренняя отделка и багажник', '68 · Interior trim and luggage compartment', 68),
    ('body', 'mb-group-69', '69 · Накладки та молдинги', '69 · Накладки и молдинги', '69 · Trim and mouldings', 69),
    ('body', 'mb-group-72', '72 · Передні двері', '72 · Передние двери', '72 · Front doors', 72),
    ('body', 'mb-group-73', '73 · Задні двері', '73 · Задние двери', '73 · Rear doors', 73),
    ('body', 'mb-group-74', '74 · Двері багажного відділення', '74 · Дверь багажного отделения', '74 · Tailgate', 74),
    ('body', 'mb-group-75', '75 · Кришка багажника', '75 · Крышка багажника', '75 · Trunk lid', 75),
    ('body', 'mb-group-76', '76 · Замки та ручки дверей', '76 · Замки и ручки дверей', '76 · Door locks and handles', 76),
    ('body', 'mb-group-77', '77 · Жорсткий знімний дах', '77 · Жёсткая съёмная крыша', '77 · Hardtop', 77),
    ('body', 'mb-group-78', '78 · Люк і панорамний дах', '78 · Люк и панорамная крыша', '78 · Sliding and panoramic roof', 78),
    ('body', 'mb-group-79', '79 · Спойлери та зовнішні елементи', '79 · Спойлеры и внешние элементы', '79 · Spoilers and exterior parts', 79),
    ('body', 'mb-group-80', '80 · Вакуумна та гідравлічна системи', '80 · Вакуумная и гидравлическая системы', '80 · Vacuum and hydraulic systems', 80),
    ('body', 'mb-group-81', '81 · Дзеркала, емблеми та оснащення', '81 · Зеркала, эмблемы и оснащение', '81 · Mirrors, emblems and equipment', 81),
    ('electrical', 'mb-group-82', '82 · Електросистема кузова', '82 · Электросистема кузова', '82 · Body electrical system', 82),
    ('climate', 'mb-group-83', '83 · Опалення, вентиляція та кондиціонер', '83 · Отопление, вентиляция и кондиционер', '83 · Heating, ventilation and air conditioning', 83),
    ('accessories', 'mb-group-84', '84 · Багажні системи та рейлінги', '84 · Багажные системы и рейлинги', '84 · Luggage systems and roof rails', 84),
    ('body', 'mb-group-85', '85 · Зовнішнє облицювання кузова', '85 · Наружная облицовка кузова', '85 · Exterior body trim', 85),
    ('interior', 'mb-group-86', '86 · Подушки та системи безпеки', '86 · Подушки и системы безопасности', '86 · Airbags and safety systems', 86),
    ('electrical', 'mb-group-87', '87 · Комфорт і мультимедіа', '87 · Комфорт и мультимедиа', '87 · Comfort and multimedia electronics', 87),
    ('body', 'mb-group-88', '88 · Бампери та навісні елементи', '88 · Бамперы и навесные элементы', '88 · Bumpers and attachment parts', 88),
    ('accessories', 'mb-group-89', '89 · Аксесуари та догляд за авто', '89 · Аксессуары и уход за автомобилем', '89 · Accessories and vehicle care', 89),
    ('electrical', 'mb-group-90', '90 · Електронні блоки та освітлення', '90 · Электронные блоки и освещение', '90 · Electronic control units and lighting', 90),
    ('interior', 'mb-group-91', '91 · Передні сидіння', '91 · Передние сиденья', '91 · Front seats', 91),
    ('interior', 'mb-group-92', '92 · Задні сидіння', '92 · Задние сиденья', '92 · Rear seats', 92),
    ('interior', 'mb-group-93', '93 · Додаткові та центральні сидіння', '93 · Дополнительные и центральные сиденья', '93 · Additional and centre seats', 93),
    ('interior', 'mb-group-97', '97 · Оббивка сидінь і підлокітники', '97 · Обивка сидений и подлокотники', '97 · Seat trim and armrests', 97),
    ('electrical', 'mb-group-98', '98 · Електричні з’єднання та захист', '98 · Электрические соединения и защита', '98 · Electrical connections and protection', 98),
    ('fasteners', 'mb-group-99', '99 · Кріплення та стандартні деталі', '99 · Крепёж и стандартные детали', '99 · Fasteners and standard parts', 99)
)
INSERT INTO categories(
  parent_id, name, name_uk, name_ru, name_en, slug, sort_order, is_active
)
SELECT parent.id, groups.name_ru, groups.name_uk, groups.name_ru,
       groups.name_en, groups.slug, groups.sort_order, TRUE
FROM groups
JOIN categories parent
  ON parent.slug = groups.parent_slug
  AND parent.is_active = TRUE
ON CONFLICT(slug) WHERE slug IS NOT NULL
DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  name = EXCLUDED.name,
  name_uk = EXCLUDED.name_uk,
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

CREATE TABLE IF NOT EXISTS mercedes_catalog_group_rules (
  group_code CHAR(2) PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mercedes_catalog_group_rules_code_check
    CHECK (group_code ~ '^[0-9]{2}$')
);

WITH mappings(group_code, category_slug) AS (
  VALUES
    ('01', 'mb-group-01'), ('03', 'mb-group-03'), ('05', 'mb-group-05'),
    ('07', 'mb-group-07'), ('09', 'mb-group-09'), ('14', 'mb-group-14'),
    ('15', 'mb-group-15'), ('18', 'mb-group-18'), ('20', 'mb-group-20'),
    ('21', 'mb-group-21'), ('22', 'mb-group-22'), ('23', 'mb-group-23'),
    ('24', 'mb-group-24'), ('25', 'mb-group-25'), ('26', 'mb-group-26'),
    ('27', 'mb-group-27'), ('28', 'mb-group-28'), ('29', 'mb-group-29'),
    ('30', 'mb-group-30'), ('31', 'mb-group-31'), ('32', 'mb-group-32'),
    ('33', 'mb-group-33'), ('35', 'mb-group-35'), ('36', 'mb-group-36'),
    ('37', 'mb-group-37'), ('40', 'mb-group-40'), ('41', 'mb-group-41'),
    ('42', 'mb-group-42'), ('43', 'mb-group-43'), ('44', 'mb-group-44'),
    ('46', 'mb-group-46'), ('47', 'mb-group-47'), ('49', 'mb-group-49'),
    ('50', 'mb-group-50'), ('52', 'mb-group-52'), ('54', 'mb-group-54'),
    ('58', 'mb-group-58'), ('60', 'mb-group-60'), ('61', 'mb-group-61'),
    ('62', 'mb-group-62'), ('63', 'mb-group-63'), ('64', 'mb-group-64'),
    ('65', 'mb-group-65'), ('67', 'mb-group-67'), ('68', 'mb-group-68'),
    ('69', 'mb-group-69'), ('72', 'mb-group-72'), ('73', 'mb-group-73'),
    ('74', 'mb-group-74'), ('75', 'mb-group-75'), ('76', 'mb-group-76'),
    ('77', 'mb-group-77'), ('78', 'mb-group-78'), ('79', 'mb-group-79'),
    ('80', 'mb-group-80'), ('81', 'mb-group-81'), ('82', 'mb-group-82'),
    ('83', 'mb-group-83'), ('84', 'mb-group-84'), ('85', 'mb-group-85'),
    ('86', 'mb-group-86'), ('87', 'mb-group-87'), ('88', 'mb-group-88'),
    ('89', 'mb-group-89'), ('90', 'mb-group-90'), ('91', 'mb-group-91'),
    ('92', 'mb-group-92'), ('93', 'mb-group-93'), ('97', 'mb-group-97'),
    ('98', 'mb-group-98'), ('99', 'mb-group-99')
)
INSERT INTO mercedes_catalog_group_rules(group_code, category_id)
SELECT mappings.group_code, category.id
FROM mappings
JOIN categories category ON category.slug = mappings.category_slug
ON CONFLICT(group_code)
DO UPDATE SET
  category_id = EXCLUDED.category_id,
  updated_at = CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION classify_product_category(target_product_id INTEGER)
RETURNS VOID AS $$
DECLARE
  target_product products%ROWTYPE;
  normalized_article TEXT;
  selected_category INTEGER;
  selected_confidence NUMERIC(5,2) := 90;
  is_mercedes BOOLEAN := FALSE;
BEGIN
  SELECT * INTO target_product
  FROM products
  WHERE id = target_product_id;

  IF target_product.id IS NULL THEN
    RETURN;
  END IF;

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
    '[^A-Z0-9]',
    '',
    'g'
  );

  IF is_mercedes THEN
    IF normalized_article LIKE 'B%' THEN
      SELECT id INTO selected_category
      FROM categories
      WHERE slug = 'mb-accessories-b'
        AND is_active = TRUE
      LIMIT 1;
      selected_confidence := 100;
    ELSIF normalized_article ~ '^A[0-9]{10}' THEN
      SELECT rule.category_id INTO selected_category
      FROM mercedes_catalog_group_rules rule
      JOIN categories category
        ON category.id = rule.category_id
        AND category.is_active = TRUE
      WHERE rule.group_code = SUBSTRING(normalized_article FROM 5 FOR 2)
      LIMIT 1;
      selected_confidence := 100;
    END IF;

    IF selected_category IS NULL THEN
      SELECT id INTO selected_category
      FROM categories
      WHERE slug = 'other'
        AND is_active = TRUE
      LIMIT 1;
      selected_confidence := 0;
    END IF;
  ELSE
    SELECT rule.category_id INTO selected_category
    FROM category_classification_rules rule
    JOIN categories category
      ON category.id = rule.category_id
      AND category.is_active = TRUE
    WHERE rule.is_active = TRUE
      AND target_product.name ~* rule.pattern
    ORDER BY rule.priority, rule.id
    LIMIT 1;
  END IF;

  DELETE FROM product_categories
  WHERE product_id = target_product_id
    AND assignment_source = 'AUTO_RULE';

  IF selected_category IS NOT NULL THEN
    INSERT INTO product_categories(
      product_id, category_id, assignment_source, confidence
    )
    VALUES(
      target_product_id, selected_category, 'AUTO_RULE', selected_confidence
    )
    ON CONFLICT(product_id, category_id)
    DO UPDATE SET
      assignment_source = 'AUTO_RULE',
      confidence = EXCLUDED.confidence;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION apply_catalog_assignment_overrides(target_product_id INTEGER)
RETURNS VOID AS $$
DECLARE
  target_product products%ROWTYPE;
  accessories_category_id INTEGER;
  normalized_article TEXT;
  is_mercedes BOOLEAN := FALSE;
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
    '[^A-Z0-9]',
    '',
    'g'
  );

  IF NOT is_mercedes OR normalized_article NOT LIKE 'B%' THEN
    RETURN;
  END IF;

  SELECT id INTO accessories_category_id
  FROM categories
  WHERE slug = 'mb-accessories-b'
    AND is_active = TRUE
  LIMIT 1;

  IF accessories_category_id IS NULL THEN
    SELECT id INTO accessories_category_id
    FROM categories
    WHERE slug = 'accessories'
      AND is_active = TRUE
    LIMIT 1;
  END IF;

  IF accessories_category_id IS NOT NULL THEN
    DELETE FROM product_categories
    WHERE product_id = target_product_id
      AND assignment_source = 'AUTO_RULE';

    INSERT INTO product_categories(
      product_id, category_id, assignment_source, confidence
    )
    VALUES(
      target_product_id, accessories_category_id, 'AUTO_RULE', 100
    )
    ON CONFLICT(product_id, category_id)
    DO UPDATE SET assignment_source = 'AUTO_RULE', confidence = 100;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_auto_category ON products;
CREATE TRIGGER products_auto_category
AFTER INSERT OR UPDATE OF name, article, article_normalized, brand_id, manufacturer_id
ON products
FOR EACH ROW
EXECUTE FUNCTION classify_product_category_trigger();

-- The general classifier now handles all Mercedes overrides itself.
DROP TRIGGER IF EXISTS zz_products_catalog_assignment_overrides ON products;

-- Reset all category choices made for Mercedes products before this migration.
-- After the one-time reset, administrators can still create new manual overrides.
DELETE FROM product_categories assignment
USING products product
WHERE assignment.product_id = product.id
  AND assignment.assignment_source = 'MANUAL'
  AND (
    EXISTS (
      SELECT 1 FROM brands brand
      WHERE brand.id = product.brand_id
        AND LOWER(brand.name) LIKE '%mercedes%'
    )
    OR EXISTS (
      SELECT 1 FROM part_manufacturers manufacturer
      WHERE manufacturer.id = product.manufacturer_id
        AND LOWER(manufacturer.name) LIKE '%mercedes%'
    )
  );

SELECT classify_product_category(id)
FROM products;

GRANT SELECT ON mercedes_catalog_group_rules TO autohub_app;
GRANT EXECUTE ON FUNCTION classify_product_category(INTEGER) TO autohub_app;
GRANT EXECUTE ON FUNCTION apply_catalog_assignment_overrides(INTEGER) TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('074_add_mercedes_article_group_categories')
ON CONFLICT(version) DO NOTHING;

COMMIT;
