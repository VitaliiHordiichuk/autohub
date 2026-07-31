BEGIN;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS slug VARCHAR(160);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_uk VARCHAR(150);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_ru VARCHAR(150);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_en VARCHAR(150);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS categories_slug_unique ON categories(slug) WHERE slug IS NOT NULL;

ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS assignment_source VARCHAR(30) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,2);

CREATE TABLE IF NOT EXISTS category_classification_rules (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS category_classification_rules_unique
  ON category_classification_rules(category_id, pattern);

INSERT INTO categories(parent_id, name, name_uk, name_ru, name_en, slug, sort_order)
VALUES
  (NULL,'Двигатель','Двигун','Двигатель','Engine','engine',10),
  (NULL,'Топливная система','Паливна система','Топливная система','Fuel system','fuel-system',20),
  (NULL,'Охлаждение','Система охолодження','Система охлаждения','Cooling system','cooling',30),
  (NULL,'Тормозная система','Гальмівна система','Тормозная система','Brake system','brakes',40),
  (NULL,'Подвеска','Підвіска','Подвеска','Suspension','suspension',50),
  (NULL,'Рулевое управление','Рульове керування','Рулевое управление','Steering','steering',60),
  (NULL,'Электрика','Електрика','Электрика','Electrical','electrical',70),
  (NULL,'Фильтры','Фільтри','Фильтры','Filters','filters',80),
  (NULL,'Кузов и стекла','Кузов і скло','Кузов и стёкла','Body and glass','body',90)
ON CONFLICT DO NOTHING;

WITH leaf(parent_slug, slug, uk, ru, en, ordering) AS (VALUES
 ('engine','engine-gaskets','Прокладки та ущільнення','Прокладки и уплотнения','Gaskets and seals',10),
 ('engine','engine-timing','ГРМ, ремені та ролики','ГРМ, ремни и ролики','Timing, belts and pulleys',20),
 ('engine','engine-mounts','Опори двигуна','Опоры двигателя','Engine mounts',30),
 ('fuel-system','fuel-pumps','Паливні насоси','Топливные насосы','Fuel pumps',10),
 ('fuel-system','fuel-injection','Форсунки та впорскування','Форсунки и впрыск','Injection',20),
 ('cooling','cooling-radiators','Радіатори','Радиаторы','Radiators',10),
 ('cooling','cooling-pumps','Водяні насоси','Водяные насосы','Water pumps',20),
 ('cooling','cooling-thermostats','Термостати','Термостаты','Thermostats',30),
 ('brakes','brake-pads','Гальмівні колодки','Тормозные колодки','Brake pads',10),
 ('brakes','brake-discs','Гальмівні диски','Тормозные диски','Brake discs',20),
 ('brakes','brake-calipers','Супорти','Суппорты','Brake calipers',30),
 ('suspension','suspension-shocks','Амортизатори та пружини','Амортизаторы и пружины','Shocks and springs',10),
 ('suspension','suspension-arms','Важелі та сайлентблоки','Рычаги и сайлентблоки','Arms and bushings',20),
 ('steering','steering-rods','Рульові тяги та наконечники','Рулевые тяги и наконечники','Tie rods',10),
 ('electrical','electrical-ignition','Запалювання','Зажигание','Ignition',10),
 ('electrical','electrical-sensors','Датчики','Датчики','Sensors',20),
 ('electrical','electrical-lighting','Освітлення','Освещение','Lighting',30),
 ('filters','filter-oil','Масляні фільтри','Масляные фильтры','Oil filters',10),
 ('filters','filter-air','Повітряні фільтри','Воздушные фильтры','Air filters',20),
 ('filters','filter-fuel','Паливні фільтри','Топливные фильтры','Fuel filters',30),
 ('filters','filter-cabin','Салонні фільтри','Салонные фильтры','Cabin filters',40),
 ('body','body-glass','Автомобільне скло','Автомобильные стёкла','Automotive glass',10),
 ('body','body-trim','Накладки та оздоблення','Накладки и отделка','Trim',20)
)
INSERT INTO categories(parent_id,name,name_uk,name_ru,name_en,slug,sort_order)
SELECT p.id, leaf.ru, leaf.uk, leaf.ru, leaf.en, leaf.slug, leaf.ordering
FROM leaf JOIN categories p ON p.slug=leaf.parent_slug
ON CONFLICT DO NOTHING;

WITH rules(slug, pattern, priority) AS (VALUES
 ('brake-pads','(колодк.*гальм|тормозн.*колод|колодк.*торм)',10),
 ('brake-discs','(диск.*гальм|тормозн.*диск)',10),
 ('brake-calipers','(супорт|суппорт)',10),
 ('filter-oil','(ф[іи]льтр.*(мастил|масл)|маслян.*ф[іи]льтр)',10),
 ('filter-air','(ф[іи]льтр.*пов[іи]тр|воздушн.*фильтр)',10),
 ('filter-fuel','(ф[іи]льтр.*палив|топливн.*фильтр)',10),
 ('filter-cabin','(ф[іи]льтр.*салон|салонн.*фильтр)',10),
 ('suspension-shocks','(амортизатор|пружин.*п[іо]дв)',20),
 ('suspension-arms','(сайлентблок|важ[іе]ль.*п[іо]дв|рычаг.*подв)',20),
 ('steering-rods','(рульов.*тяг|рулев.*тяг|рульов.*након|рулев.*након)',20),
 ('cooling-radiators','(рад[іи]атор)',30),
 ('cooling-thermostats','(термостат)',20),
 ('cooling-pumps','(водян.*насос|помпа.*вод|насос.*охолод|насос.*охлаж)',20),
 ('fuel-pumps','(паливн.*насос|топливн.*насос)',20),
 ('fuel-injection','(форсунк|інжектор|инжектор)',30),
 ('engine-timing','(ролик.*натяж|рем[іе]нь.*грм|ланцюг.*грм|цепь.*грм)',20),
 ('engine-mounts','(опор.*двигун|опор.*двигат|подушк.*двиг)',20),
 ('engine-gaskets','(прокладк|ущ[іи]льнювач|уплотнител|сальник)',80),
 ('electrical-ignition','(св[іе]ч.*запал|свеч.*зажиг|котушк.*запал|катушк.*зажиг)',20),
 ('electrical-sensors','(датчик|сенсор)',80),
 ('electrical-lighting','(фара|ліхтар|фонар|ламп.*авто)',50),
 ('body-glass','(скло.*(лоб|бок|зад)|стекло.*(лоб|бок|зад))',20),
 ('body-trim','(накладк|молдинг)',90)
)
INSERT INTO category_classification_rules(category_id,pattern,priority)
SELECT c.id,r.pattern,r.priority FROM rules r JOIN categories c ON c.slug=r.slug
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION classify_product_category(target_product_id INTEGER)
RETURNS VOID AS $$
DECLARE selected_category INTEGER;
BEGIN
  SELECT rule.category_id INTO selected_category
  FROM products p
  JOIN category_classification_rules rule ON rule.is_active AND p.name ~* rule.pattern
  WHERE p.id = target_product_id
  ORDER BY rule.priority, rule.id LIMIT 1;

  DELETE FROM product_categories
  WHERE product_id = target_product_id AND assignment_source = 'AUTO_RULE';

  IF selected_category IS NOT NULL THEN
    INSERT INTO product_categories(product_id,category_id,assignment_source,confidence)
    VALUES(target_product_id,selected_category,'AUTO_RULE',90)
    ON CONFLICT(product_id,category_id) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION classify_product_category_trigger()
RETURNS TRIGGER AS $$ BEGIN
  PERFORM classify_product_category(NEW.id); RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_auto_category ON products;
CREATE TRIGGER products_auto_category AFTER INSERT OR UPDATE OF name ON products
FOR EACH ROW EXECUTE FUNCTION classify_product_category_trigger();

SELECT classify_product_category(id) FROM products;

INSERT INTO schema_migrations(version) VALUES ('039_add_automatic_product_categories')
ON CONFLICT(version) DO NOTHING;
COMMIT;
