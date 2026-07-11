BEGIN;

ALTER TABLE order_item_history
DROP CONSTRAINT IF EXISTS order_item_history_action_check;

ALTER TABLE order_item_history
ADD CONSTRAINT order_item_history_action_check
CHECK (
action IN (
'QUANTITY_CHANGED',
'PRICE_CHANGED',
'REMOVED',
'RESTORED',
'ADDED'
)
);

INSERT INTO schema_migrations(version)
VALUES ('007_add_added_history_action')
ON CONFLICT(version) DO NOTHING;

COMMIT;