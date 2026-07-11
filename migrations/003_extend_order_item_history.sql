BEGIN;

ALTER TABLE order_item_history
    ADD COLUMN IF NOT EXISTS action VARCHAR(50),
    ADD COLUMN IF NOT EXISTS old_quantity NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS new_quantity NUMERIC(10,2);

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
            'REMOVED'
        )
    );

CREATE INDEX IF NOT EXISTS
    idx_order_item_history_action
ON order_item_history(action);

GRANT SELECT, INSERT, UPDATE, DELETE
ON order_item_history
TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES('003_extend_order_item_history')
ON CONFLICT(version) DO NOTHING;

COMMIT;