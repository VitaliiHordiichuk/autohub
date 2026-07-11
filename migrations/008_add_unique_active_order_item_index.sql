BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_order_item
ON order_items(order_id, product_offer_id)
WHERE status = 'ACTIVE';

INSERT INTO schema_migrations(version)
VALUES ('008_add_unique_active_order_item_index');

COMMIT;