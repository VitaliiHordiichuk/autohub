BEGIN;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS inventory_model VARCHAR(30)
    NOT NULL DEFAULT 'LEGACY_RESERVATION',
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE checkout_sessions
  ALTER COLUMN expires_at DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkout_sessions_inventory_model_check'
  ) THEN
    ALTER TABLE checkout_sessions
      ADD CONSTRAINT checkout_sessions_inventory_model_check
      CHECK (inventory_model IN ('LEGACY_RESERVATION', 'COMMIT_ON_SUBMIT'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_checkout_sessions_commit_idempotency
ON checkout_sessions(idempotency_key)
WHERE inventory_model = 'COMMIT_ON_SUBMIT'
  AND idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS checkout_session_items (
  id SERIAL PRIMARY KEY,
  checkout_session_id INTEGER NOT NULL
    REFERENCES checkout_sessions(id) ON DELETE CASCADE,
  cart_item_id INTEGER
    REFERENCES cart_items(id) ON DELETE SET NULL,
  product_offer_id INTEGER NOT NULL
    REFERENCES product_offers(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  price_snapshot NUMERIC NOT NULL CHECK (price_snapshot >= 0),
  fulfillment_type VARCHAR(30) NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  article_snapshot VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT checkout_session_items_fulfillment_check
    CHECK (fulfillment_type IN ('STOCK', 'SUPPLIER_ORDER')),
  CONSTRAINT checkout_session_items_session_cart_item_unique
    UNIQUE (checkout_session_id, cart_item_id)
);

CREATE INDEX IF NOT EXISTS idx_checkout_session_items_offer
  ON checkout_session_items(product_offer_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS inventory_model VARCHAR(30)
    NOT NULL DEFAULT 'LEGACY_RESERVATION',
  ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(30)
    NOT NULL DEFAULT 'STOCK',
  ADD COLUMN IF NOT EXISTS checkout_session_id INTEGER
    REFERENCES checkout_sessions(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_inventory_model_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_inventory_model_check
      CHECK (inventory_model IN ('LEGACY_RESERVATION', 'COMMIT_ON_SUBMIT'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_fulfillment_type_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_fulfillment_type_check
      CHECK (fulfillment_type IN ('STOCK', 'SUPPLIER_ORDER'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_checkout_fulfillment
  ON orders(checkout_session_id, fulfillment_type)
  WHERE checkout_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS checkout_session_orders (
  checkout_session_id INTEGER NOT NULL
    REFERENCES checkout_sessions(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL
    REFERENCES orders(id) ON DELETE CASCADE,
  fulfillment_type VARCHAR(30) NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (checkout_session_id, fulfillment_type),
  UNIQUE (order_id),
  CONSTRAINT checkout_session_orders_fulfillment_check
    CHECK (fulfillment_type IN ('STOCK', 'SUPPLIER_ORDER'))
);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(30)
    NOT NULL DEFAULT 'STOCK',
  ADD COLUMN IF NOT EXISTS inventory_committed_quantity NUMERIC
    NOT NULL DEFAULT 0 CHECK (inventory_committed_quantity >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_items_fulfillment_type_check'
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_fulfillment_type_check
      CHECK (fulfillment_type IN ('STOCK', 'SUPPLIER_ORDER'));
  END IF;
END $$;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS operation_key VARCHAR(180);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_operation_key
  ON stock_movements(operation_key)
  WHERE operation_key IS NOT NULL;

ALTER TABLE product_offers
  ADD COLUMN IF NOT EXISTS last_import_quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS last_import_at TIMESTAMP WITHOUT TIME ZONE;

-- Establish the current physical stock as the import baseline before the
-- feature flag can commit any new sales. Without this one-time baseline, the
-- first repeated own-stock file could treat a post-sale quantity as if it were
-- the previous supplier snapshot and add the sold units back.
UPDATE product_offers
SET last_import_quantity = quantity
WHERE last_import_quantity IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON checkout_session_items, checkout_session_orders
  TO autohub_app;

GRANT USAGE, SELECT
  ON SEQUENCE checkout_session_items_id_seq
  TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('105_add_commit_on_submit_checkout')
ON CONFLICT(version) DO NOTHING;

COMMIT;
