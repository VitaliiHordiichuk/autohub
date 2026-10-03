BEGIN;

CREATE TABLE IF NOT EXISTS customer_categories (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(160) NOT NULL,
  parent_id INTEGER REFERENCES customer_categories(id) ON DELETE RESTRICT,
  status VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  is_navigation_visible BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_categories_slug_unique UNIQUE (slug),
  CONSTRAINT customer_categories_status_check
    CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  CONSTRAINT customer_categories_parent_check
    CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT customer_categories_navigation_check
    CHECK (
      is_navigation_visible = FALSE
      OR (status = 'ACTIVE' AND is_active = TRUE)
    ),
  CONSTRAINT customer_categories_slug_check
    CHECK (
      slug = LOWER(slug)
      AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    )
);

CREATE INDEX IF NOT EXISTS customer_categories_parent_sort_idx
  ON customer_categories(parent_id, sort_order, id);

CREATE INDEX IF NOT EXISTS customer_categories_status_active_sort_idx
  ON customer_categories(status, is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS customer_category_translations (
  category_id INTEGER NOT NULL
    REFERENCES customer_categories(id) ON DELETE CASCADE,
  language_code VARCHAR(5) NOT NULL
    REFERENCES site_languages(code) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  seo_title VARCHAR(200),
  seo_description VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category_id, language_code),
  CONSTRAINT customer_category_translations_name_check
    CHECK (BTRIM(name) <> '')
);

CREATE INDEX IF NOT EXISTS customer_category_translations_language_idx
  ON customer_category_translations(language_code, category_id);

CREATE TABLE IF NOT EXISTS customer_classification_rules (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(120) NOT NULL,
  version INTEGER NOT NULL,
  detector_version INTEGER NOT NULL DEFAULT 1,
  source_kind VARCHAR(20) NOT NULL,
  assignment_role VARCHAR(12) NOT NULL DEFAULT 'PRIMARY',
  number_family VARCHAR(16),
  epc_group VARCHAR(10),
  match_type VARCHAR(20) NOT NULL,
  match_value VARCHAR(160),
  exclude_values TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  target_category_id INTEGER NOT NULL
    REFERENCES customer_categories(id) ON DELETE RESTRICT,
  priority INTEGER NOT NULL DEFAULT 100,
  confidence VARCHAR(10) NOT NULL,
  auto_approval_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_classification_rules_code_version_unique
    UNIQUE (code, version),
  CONSTRAINT customer_classification_rules_version_check
    CHECK (version > 0),
  CONSTRAINT customer_classification_rules_detector_version_check
    CHECK (detector_version > 0),
  CONSTRAINT customer_classification_rules_source_check
    CHECK (source_kind IN ('RULE', 'EPC_FALLBACK')),
  CONSTRAINT customer_classification_rules_role_check
    CHECK (assignment_role IN ('PRIMARY', 'SECONDARY')),
  CONSTRAINT customer_classification_rules_family_check
    CHECK (
      number_family IS NULL
      OR number_family IN ('A', 'N', 'B', 'OTHER')
    ),
  CONSTRAINT customer_classification_rules_match_type_check
    CHECK (
      match_type IN (
        'TYPE_CODE',
        'ARTICLE_EXACT',
        'ARTICLE_PREFIX',
        'EPC_ONLY'
      )
    ),
  CONSTRAINT customer_classification_rules_match_value_check
    CHECK (
      (
        match_type = 'EPC_ONLY'
        AND epc_group IS NOT NULL
        AND match_value IS NULL
      )
      OR (
        match_type <> 'EPC_ONLY'
        AND match_value IS NOT NULL
        AND BTRIM(match_value) <> ''
      )
    ),
  CONSTRAINT customer_classification_rules_exclusions_check
    CHECK (ARRAY_POSITION(exclude_values, NULL) IS NULL),
  CONSTRAINT customer_classification_rules_priority_check
    CHECK (priority >= 0),
  CONSTRAINT customer_classification_rules_confidence_check
    CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  CONSTRAINT customer_classification_rules_auto_approval_check
    CHECK (auto_approval_allowed = FALSE OR confidence = 'HIGH')
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_classification_rules_active_code_unique
  ON customer_classification_rules(code)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS customer_classification_rules_resolution_idx
  ON customer_classification_rules(
    is_active,
    number_family,
    epc_group,
    priority,
    id
  );

CREATE INDEX IF NOT EXISTS customer_classification_rules_target_idx
  ON customer_classification_rules(target_category_id, is_active);

CREATE INDEX IF NOT EXISTS customer_classification_rules_match_idx
  ON customer_classification_rules(match_type, match_value)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS product_customer_categories (
  product_id INTEGER NOT NULL
    REFERENCES products(id) ON DELETE CASCADE,
  customer_category_id INTEGER NOT NULL
    REFERENCES customer_categories(id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  assignment_source VARCHAR(20) NOT NULL,
  assignment_origin VARCHAR(20) NOT NULL,
  rule_code VARCHAR(120),
  rule_version INTEGER,
  confidence VARCHAR(10) NOT NULL,
  approval_status VARCHAR(20) NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, customer_category_id),
  CONSTRAINT product_customer_categories_rule_fkey
    FOREIGN KEY (rule_code, rule_version)
    REFERENCES customer_classification_rules(code, version)
    ON DELETE RESTRICT,
  CONSTRAINT product_customer_categories_source_check
    CHECK (assignment_source IN ('MANUAL', 'RULE', 'EPC_FALLBACK')),
  CONSTRAINT product_customer_categories_origin_check
    CHECK (
      assignment_origin IN (
        'ADMIN',
        'IMPORT',
        'BACKFILL',
        'MIGRATION',
        'SYSTEM'
      )
    ),
  CONSTRAINT product_customer_categories_rule_pair_check
    CHECK (
      (rule_code IS NULL AND rule_version IS NULL)
      OR (rule_code IS NOT NULL AND rule_version IS NOT NULL)
    ),
  CONSTRAINT product_customer_categories_rule_source_check
    CHECK (
      assignment_source = 'MANUAL'
      OR rule_code IS NOT NULL
    ),
  CONSTRAINT product_customer_categories_manual_rule_check
    CHECK (
      assignment_source <> 'MANUAL'
      OR (rule_code IS NULL AND rule_version IS NULL)
    ),
  CONSTRAINT product_customer_categories_confidence_check
    CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  CONSTRAINT product_customer_categories_approval_check
    CHECK (
      approval_status IN (
        'AUTO_APPROVED',
        'MANUAL_APPROVED',
        'REVIEW',
        'REJECTED'
      )
    ),
  CONSTRAINT product_customer_categories_auto_approval_check
    CHECK (
      approval_status <> 'AUTO_APPROVED'
      OR (
        assignment_source IN ('RULE', 'EPC_FALLBACK')
        AND confidence = 'HIGH'
      )
    ),
  CONSTRAINT product_customer_categories_approved_at_check
    CHECK (
      (
        approval_status IN ('AUTO_APPROVED', 'MANUAL_APPROVED')
        AND approved_at IS NOT NULL
      )
      OR (
        approval_status IN ('REVIEW', 'REJECTED')
        AND approved_at IS NULL
      )
    ),
  CONSTRAINT product_customer_categories_primary_check
    CHECK (
      is_primary = FALSE
      OR approval_status IN ('AUTO_APPROVED', 'MANUAL_APPROVED')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS product_customer_categories_primary_unique
  ON product_customer_categories(product_id)
  WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS product_customer_categories_product_status_idx
  ON product_customer_categories(
    product_id,
    approval_status,
    customer_category_id
  );

CREATE INDEX IF NOT EXISTS product_customer_categories_category_status_idx
  ON product_customer_categories(
    customer_category_id,
    approval_status,
    product_id
  );

CREATE INDEX IF NOT EXISTS product_customer_categories_review_queue_idx
  ON product_customer_categories(assigned_at, product_id)
  WHERE approval_status = 'REVIEW';

CREATE INDEX IF NOT EXISTS product_customer_categories_rule_idx
  ON product_customer_categories(rule_code, rule_version)
  WHERE rule_code IS NOT NULL;

WITH top_level(
  slug, sort_order, name_uk, name_ru, name_en
) AS (
  VALUES
    ('filters-maintenance', 10, 'Фільтри й ТО', 'Фильтры и ТО', 'Filters & maintenance'),
    ('engine', 20, 'Двигун', 'Двигатель', 'Engine'),
    ('cooling', 30, 'Охолодження', 'Охлаждение', 'Cooling'),
    ('fuel-system', 40, 'Паливна система', 'Топливная система', 'Fuel system'),
    ('exhaust', 50, 'Вихлоп', 'Выхлоп', 'Exhaust'),
    ('transmission-drivetrain', 60, 'Трансмісія та привід', 'Трансмиссия и привод', 'Transmission & drivetrain'),
    ('brakes', 70, 'Гальмівна система', 'Тормозная система', 'Brake system'),
    ('suspension', 80, 'Підвіска', 'Подвеска', 'Suspension'),
    ('steering', 90, 'Рульове керування', 'Рулевое управление', 'Steering'),
    ('climate', 100, 'Клімат', 'Климат', 'Climate control'),
    ('electrical-electronics-lighting', 110, 'Електрика, електроніка та освітлення', 'Электрика, электроника и освещение', 'Electrical, electronics & lighting'),
    ('body-glass', 120, 'Кузов і скло', 'Кузов и стекло', 'Body & glass'),
    ('interior-safety', 130, 'Салон і безпека', 'Салон и безопасность', 'Interior & safety'),
    ('wheels', 140, 'Колеса', 'Колёса', 'Wheels'),
    ('fasteners-seals-standard-parts', 150, 'Кріплення, ущільнення та стандартні деталі', 'Крепёж, уплотнения и стандартные детали', 'Fasteners, seals & standard parts'),
    ('accessories', 160, 'Аксесуари', 'Аксессуары', 'Accessories')
), inserted AS (
  INSERT INTO customer_categories(
    slug,
    parent_id,
    status,
    is_active,
    is_navigation_visible,
    sort_order
  )
  SELECT slug, NULL, 'ACTIVE', TRUE, FALSE, sort_order
  FROM top_level
  ON CONFLICT (slug) DO UPDATE SET
    parent_id = NULL,
    status = 'ACTIVE',
    is_active = TRUE,
    is_navigation_visible = FALSE,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW()
  RETURNING id, slug
)
INSERT INTO customer_category_translations(
  category_id,
  language_code,
  name
)
SELECT category.id, translation.language_code, translation.name
FROM top_level source
JOIN inserted category ON category.slug = source.slug
CROSS JOIN LATERAL (
  VALUES
    ('uk', source.name_uk),
    ('ru', source.name_ru),
    ('en', source.name_en)
) translation(language_code, name)
ON CONFLICT (category_id, language_code) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();

WITH ready_leaf(
  parent_slug,
  slug,
  sort_order,
  name_uk,
  name_ru,
  name_en
) AS (
  VALUES
    ('filters-maintenance', 'filters-oil', 10, 'Масляні фільтри', 'Масляные фильтры', 'Oil filters'),
    ('filters-maintenance', 'filters-engine-air', 20, 'Повітряні фільтри двигуна', 'Воздушные фильтры двигателя', 'Engine air filters'),
    ('filters-maintenance', 'filters-cabin', 30, 'Салонні фільтри', 'Салонные фильтры', 'Cabin filters'),
    ('filters-maintenance', 'filters-fuel', 40, 'Паливні фільтри', 'Топливные фильтры', 'Fuel filters'),
    ('filters-maintenance', 'filters-spark-ignition', 50, 'Свічки / запалювання', 'Свечи / зажигание', 'Spark plugs / ignition'),
    ('filters-maintenance', 'filters-belts', 60, 'Ремені', 'Ремни', 'Belts'),
    ('filters-maintenance', 'filters-rollers-tensioners', 70, 'Ролики та натягувачі', 'Ролики и натяжители', 'Pulleys and tensioners'),
    ('filters-maintenance', 'filters-wipers', 80, 'Склоочисники', 'Стеклоочистители', 'Wipers'),
    ('brakes', 'brakes-pads', 10, 'Гальмівні колодки', 'Колодки', 'Brake pads'),
    ('brakes', 'brakes-discs', 20, 'Гальмівні диски', 'Диски', 'Brake discs'),
    ('brakes', 'brakes-calipers', 30, 'Супорти', 'Суппорты', 'Brake calipers'),
    ('brakes', 'brakes-sensors', 40, 'Датчики', 'Датчики', 'Sensors'),
    ('brakes', 'brakes-hoses-pipes', 50, 'Шланги / трубки', 'Шланги / трубки', 'Hoses / pipes'),
    ('brakes', 'brakes-master-cylinders', 60, 'Головні циліндри', 'Главные цилиндры', 'Master cylinders'),
    ('accessories', 'accessories-floor-mats', 10, 'Килимки', 'Коврики', 'Floor mats'),
    ('accessories', 'accessories-luggage', 20, 'Багаж і перевезення', 'Багаж и перевозка', 'Luggage and transport'),
    ('accessories', 'accessories-interior', 30, 'Інтер’єр', 'Интерьер', 'Interior'),
    ('accessories', 'accessories-exterior', 40, 'Екстер’єр', 'Экстерьер', 'Exterior'),
    ('accessories', 'accessories-wheels', 50, 'Колеса', 'Колёса', 'Wheels'),
    ('accessories', 'accessories-multimedia', 60, 'Мультимедіа', 'Мультимедиа', 'Multimedia'),
    ('accessories', 'accessories-collection', 70, 'Mercedes-Benz Collection', 'Mercedes-Benz Collection', 'Mercedes-Benz Collection')
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
  FROM ready_leaf leaf
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
INSERT INTO customer_category_translations(
  category_id,
  language_code,
  name
)
SELECT category.id, translation.language_code, translation.name
FROM ready_leaf source
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

GRANT SELECT, INSERT, UPDATE, DELETE
  ON customer_categories,
     customer_category_translations,
     customer_classification_rules,
     product_customer_categories
  TO autohub_app;

GRANT USAGE, SELECT
  ON SEQUENCE customer_categories_id_seq,
              customer_classification_rules_id_seq
  TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('087_create_customer_taxonomy')
ON CONFLICT(version) DO NOTHING;

COMMIT;
