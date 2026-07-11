BEGIN;

ALTER TABLE order_item_history
DROP CONSTRAINT IF EXISTS order_item_history_action_check;

ALTER TABLE order_item_history
ADD CONSTRAINT order_item_history_action_check
CHECK (
    action IS NULL
    OR action IN (
        'CREATED',
        'QUANTITY_CHANGED',
        'PRICE_CHANGED',
        'OFFER_CHANGED',
        'REMOVED',
        'RESTORED'
    )
);

INSERT INTO schema_migrations (version)
VALUES ('006_add_restored_history_action')
ON CONFLICT (version) DO NOTHING;

COMMIT;