BEGIN;

ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS status VARCHAR(30)
DEFAULT 'ACTIVE';

UPDATE order_items
SET status = 'ACTIVE'
WHERE status IS NULL;

ALTER TABLE order_items
DROP CONSTRAINT IF EXISTS order_items_status_check;

ALTER TABLE order_items
ADD CONSTRAINT order_items_status_check
CHECK (
    status IN (
        'ACTIVE',
        'REMOVED'
    )
);

CREATE INDEX IF NOT EXISTS idx_order_items_status
ON order_items(order_id, status);

INSERT INTO schema_migrations(version)
VALUES ('005_add_order_item_status')
ON CONFLICT(version) DO NOTHING;

COMMIT;