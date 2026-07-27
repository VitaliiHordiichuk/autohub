BEGIN;

ALTER TABLE warehouse_supplier_imports
  ADD COLUMN IF NOT EXISTS
    new_products_mode VARCHAR(20)
    NOT NULL DEFAULT 'AUTO',

  ADD COLUMN IF NOT EXISTS
    price_drop_threshold NUMERIC(8,2)
    NOT NULL DEFAULT 30,

  ADD COLUMN IF NOT EXISTS
    price_rise_threshold NUMERIC(8,2)
    NOT NULL DEFAULT 40;

UPDATE warehouse_supplier_imports
SET new_products_mode = 'AUTO'
WHERE new_products_mode IS NULL
   OR new_products_mode = 'AUTO';

ALTER TABLE warehouse_supplier_imports
  ALTER COLUMN new_products_mode
  SET DEFAULT 'REVIEW';

ALTER TABLE warehouse_supplier_imports
  DROP CONSTRAINT IF EXISTS
    warehouse_supplier_imports_new_products_mode_check;

ALTER TABLE warehouse_supplier_imports
  ADD CONSTRAINT
    warehouse_supplier_imports_new_products_mode_check
  CHECK (
    new_products_mode IN (
      'REVIEW',
      'AUTO',
      'IGNORE'
    )
  );

ALTER TABLE warehouse_supplier_imports
  DROP CONSTRAINT IF EXISTS
    warehouse_supplier_imports_price_drop_threshold_check;

ALTER TABLE warehouse_supplier_imports
  ADD CONSTRAINT
    warehouse_supplier_imports_price_drop_threshold_check
  CHECK (
    price_drop_threshold >= 0
    AND price_drop_threshold <= 100000
  );

ALTER TABLE warehouse_supplier_imports
  DROP CONSTRAINT IF EXISTS
    warehouse_supplier_imports_price_rise_threshold_check;

ALTER TABLE warehouse_supplier_imports
  ADD CONSTRAINT
    warehouse_supplier_imports_price_rise_threshold_check
  CHECK (
    price_rise_threshold >= 0
    AND price_rise_threshold <= 100000
  );

ALTER TABLE imports
  ADD COLUMN IF NOT EXISTS
    new_products_count INTEGER
    NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS
    pending_new_products_count INTEGER
    NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS
    ignored_new_products_count INTEGER
    NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS
    price_changes_count INTEGER
    NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS
    price_drop_count INTEGER
    NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS
    price_rise_count INTEGER
    NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS
  import_new_products (
    id SERIAL PRIMARY KEY,

    warehouse_id INTEGER NOT NULL
      REFERENCES warehouses(id)
      ON DELETE CASCADE,

    supplier_id INTEGER
      REFERENCES suppliers(id)
      ON DELETE SET NULL,

    warehouse_supplier_import_id INTEGER
      REFERENCES warehouse_supplier_imports(id)
      ON DELETE SET NULL,

    brand_id INTEGER NOT NULL
      REFERENCES brands(id),

    article VARCHAR(100) NOT NULL,
    article_normalized VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,

    price NUMERIC(12,2) NOT NULL,
    quantity NUMERIC(10,2) NOT NULL,

    status VARCHAR(20)
      NOT NULL DEFAULT 'PENDING',

    first_import_id INTEGER
      REFERENCES imports(id)
      ON DELETE SET NULL,

    latest_import_id INTEGER
      REFERENCES imports(id)
      ON DELETE SET NULL,

    latest_import_row_id INTEGER
      REFERENCES import_rows(id)
      ON DELETE SET NULL,

    product_id INTEGER
      REFERENCES products(id)
      ON DELETE SET NULL,

    product_offer_id INTEGER
      REFERENCES product_offers(id)
      ON DELETE SET NULL,

    resolved_at TIMESTAMP,
    created_at TIMESTAMP
      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT
      import_new_products_status_check
    CHECK (
      status IN (
        'PENDING',
        'APPROVED',
        'REJECTED'
      )
    ),

    CONSTRAINT
      import_new_products_price_check
    CHECK (price >= 0),

    CONSTRAINT
      import_new_products_quantity_check
    CHECK (quantity >= 0),

    CONSTRAINT
      import_new_products_unique_position
    UNIQUE (
      warehouse_id,
      brand_id,
      article_normalized
    )
  );

CREATE INDEX IF NOT EXISTS
  idx_import_new_products_pending
ON import_new_products (
  warehouse_id,
  status,
  updated_at DESC
);

CREATE INDEX IF NOT EXISTS
  idx_import_rows_price_alerts
ON import_rows (
  import_id,
  status
)
WHERE status IN (
  'PRICE_DROP_ALERT',
  'PRICE_RISE_ALERT'
);

INSERT INTO schema_migrations (
  version
)
VALUES (
  '032'
)
ON CONFLICT(version)
DO NOTHING;

COMMIT;
