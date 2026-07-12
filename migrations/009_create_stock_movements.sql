BEGIN;

ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS order_id INTEGER,
    ADD COLUMN IF NOT EXISTS order_item_id INTEGER;

ALTER TABLE stock_movements
    DROP CONSTRAINT IF EXISTS stock_movements_order_id_fkey;

ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_order_id_fkey
    FOREIGN KEY (order_id)
    REFERENCES orders(id)
    ON DELETE SET NULL;

ALTER TABLE stock_movements
    DROP CONSTRAINT IF EXISTS stock_movements_order_item_id_fkey;

ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_order_item_id_fkey
    FOREIGN KEY (order_item_id)
    REFERENCES order_items(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_order
ON stock_movements(order_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_order_item
ON stock_movements(order_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_sale_order_item
ON stock_movements(order_item_id)
WHERE type = 'SALE'
  AND order_item_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE
ON stock_movements
TO autohub_app;

GRANT USAGE, SELECT
ON SEQUENCE stock_movements_id_seq
TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('009_create_stock_movements')
ON CONFLICT(version) DO NOTHING;

COMMIT;