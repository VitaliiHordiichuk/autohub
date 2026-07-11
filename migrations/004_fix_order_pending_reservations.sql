BEGIN;

UPDATE stock_reservations
SET reserved_until = NULL
WHERE status = 'ORDER_PENDING';

INSERT INTO schema_migrations (version)
VALUES ('004_fix_order_pending_reservations')
ON CONFLICT (version) DO NOTHING;

COMMIT;